import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

/**
 * Frame-locked AI image editing — shared library.
 *
 * ROOT CAUSE this library fixes:
 * The z-ai image-edit endpoint only accepts fixed canvases
 * (1024x1024 … 1440x720). When the source photo's aspect ratio does
 * not match the requested canvas, the service CENTER-CROPS the input
 * → part of the photo's edges silently disappears ("اقتصاص" bug) and
 * the final resize back distorts body proportions.
 *
 * Fix strategy (frame-lock):
 *   1. Pick the supported canvas CLOSEST to the source aspect ratio.
 *   2. PRE-STRETCH the source to the EXACT canvas aspect (fit: fill)
 *      → the backend no longer needs to crop anything, so the full
 *      field of view survives.
 *   3. Run the AI edit on the fitted image.
 *   4. INVERSE-stretch the result back to the source dimensions —
 *      the tiny stretch cancels out pixel-perfectly, keeping true
 *      body proportions.
 *   5. EDGE-LOCK (optional): compare the structure of the 4 border
 *      bands of the AI result against the original. If the model
 *      re-framed (zoomed / cropped / shifted), restore the original
 *      border band with a feathered blend so no edge content is ever
 *      lost, while the center keeps the AI improvement.
 */

export const AI_CANVAS_SIZES = [
  "1024x1024",
  "768x1344",
  "864x1152",
  "1344x768",
  "1152x864",
  "1440x720",
  "720x1440",
] as const;

export type AiCanvasSize = (typeof AI_CANVAS_SIZES)[number];

/** Pick the supported AI canvas whose aspect ratio is closest to the source. */
export function pickAiCanvasSize(srcW: number, srcH: number): AiCanvasSize {
  const srcRatio = srcW / srcH;
  let best: AiCanvasSize = "1024x1024";
  let bestDiff = Infinity;
  for (const s of AI_CANVAS_SIZES) {
    const [sw, sh] = s.split("x").map(Number);
    const diff = Math.abs(sw / sh - srcRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Edge fingerprints — color/brightness invariant structure comparison
// ---------------------------------------------------------------------------

const FINGERPRINT_W = 64;
const FINGERPRINT_H = 16;
/** Normalized structural distance above which a border band is "different". */
const REFRAME_THRESHOLD = 0.5;

async function bandFingerprint(
  buf: Buffer,
  region: { left: number; top: number; width: number; height: number }
): Promise<Float32Array | null> {
  try {
    const raw = await sharp(buf)
      .extract(region)
      .greyscale()
      .resize(FINGERPRINT_W, FINGERPRINT_H, { fit: "fill" })
      .raw()
      .toBuffer();
    const n = raw.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += raw[i];
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const d = raw[i] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / n);
    if (std < 4) return null; // flat band — no structure to compare
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (raw[i] - mean) / std;
    return out;
  } catch {
    return null;
  }
}

function fingerprintDiff(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n;
}

/** Detect whether the AI output framing no longer matches the original. */
async function detectReframe(
  aiBuf: Buffer,
  origBuf: Buffer,
  w: number,
  h: number
): Promise<boolean> {
  const bw = Math.max(8, Math.round(w * 0.1));
  const bh = Math.max(8, Math.round(h * 0.1));
  const regions = [
    { left: 0, top: 0, width: w, height: bh }, // top
    { left: 0, top: h - bh, width: w, height: bh }, // bottom
    { left: 0, top: 0, width: bw, height: h }, // left
    { left: w - bw, top: 0, width: bw, height: h }, // right
  ];
  for (const r of regions) {
    const a = await bandFingerprint(aiBuf, r);
    if (!a) continue;
    const b = await bandFingerprint(origBuf, r);
    if (!b) continue;
    if (fingerprintDiff(a, b) > REFRAME_THRESHOLD) return true;
  }
  return false;
}

/**
 * Build a feathered border frame from the original image:
 * opaque original at the outer band, fading to transparent toward
 * the center. Uses a luminance→alpha channel join (a plain
 * dest-in SVG mask does NOT work — SVG rects are opaque regardless
 * of their color, so the feather would silently no-op).
 */
export async function buildFeatheredFrame(
  origBuf: Buffer<ArrayBufferLike>,
  w: number,
  h: number,
  bandPct = 0.1
): Promise<Buffer> {
  const bw = Math.max(8, Math.round(w * bandPct));
  const bh = Math.max(8, Math.round(h * bandPct));
  const blur = Math.max(8, Math.round(Math.min(w, h) * 0.02));

  // White frame over-extends past the canvas so blurring keeps the
  // outer edge fully opaque (only the INNER edge feathers).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect x="${-blur * 2}" y="${-blur * 2}" width="${w + blur * 4}" height="${h + blur * 4}" fill="white"/>
  <rect x="${bw}" y="${bh}" width="${Math.max(1, w - 2 * bw)}" height="${Math.max(1, h - 2 * bh)}" fill="black"/>
</svg>`;
  const maskGray = await sharp(Buffer.from(svg))
    .blur(blur)
    .greyscale()
    .raw()
    .toBuffer();

  const rgb = await sharp(origBuf).removeAlpha().toColourspace("srgb").png().toBuffer();
  return sharp(rgb)
    .joinChannel(maskGray, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Main entry — frame-locked AI edit
// ---------------------------------------------------------------------------

export interface AiEditFrameLockOptions {
  /** Filesystem path of the source image (or use sourceBuffer). */
  sourcePath?: string;
  /** Raw source image buffer (alternative to sourcePath). */
  sourceBuffer?: Buffer<ArrayBufferLike>;
  /** The AI edit prompt. */
  prompt: string;
  /**
   * Restore original border bands when the model re-frames.
   * Enable for edits that must NOT change border content
   * (retouch, enhance, age). Disable when borders legitimately
   * change (colorize, restore, style, background ops).
   * Default: true.
   */
  edgeLock?: boolean;
  /** Optional canvas override (must be one of AI_CANVAS_SIZES). */
  size?: string;
  /** Extra reference images appended after the fitted source. */
  extraImages?: Array<{ url: string }>;
}

export interface AiEditFrameLockResult {
  buffer: Buffer<ArrayBufferLike>;
  width: number;
  height: number;
  canvas: string;
  edgeLockApplied: boolean;
}

/**
 * Run a z-ai image edit WITHOUT losing any of the original frame.
 * Always returns a buffer at the source's exact dimensions.
 */
export async function aiEditFrameLocked(
  opts: AiEditFrameLockOptions
): Promise<AiEditFrameLockResult> {
  if (!opts.sourcePath && !opts.sourceBuffer) {
    throw new Error("aiEditFrameLocked: sourcePath or sourceBuffer is required");
  }

  const srcBuf: Buffer =
    opts.sourceBuffer ?? (await fs.readFile(opts.sourcePath as string));
  const meta = await sharp(srcBuf).metadata();
  const srcW = meta.width ?? 768;
  const srcH = meta.height ?? 1024;

  const canvas =
    (opts.size as AiCanvasSize | undefined) ?? pickAiCanvasSize(srcW, srcH);
  const [cw, ch] = canvas.split("x").map(Number);

  // 1) PRE-STRETCH to the exact canvas aspect — the backend center-crops
  //    mismatched inputs, which is exactly what ate the photo's edges.
  const fitted = await sharp(srcBuf)
    .resize(cw, ch, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();

  const images: Array<{ url: string }> = [
    { url: `data:image/png;base64,${fitted.toString("base64")}` },
    ...(opts.extraImages ?? []),
  ];

  const ZAIModule = await import("z-ai-web-dev-sdk");
  const zai = await ZAIModule.default.create();
  const res = await (zai.images.generations.edit as (o: unknown) => Promise<{
    data?: Array<{ base64?: string }>;
  }>)({ prompt: opts.prompt, images, size: canvas });

  const b64 = res?.data?.[0]?.base64;
  if (!b64) throw new Error("AI returned no image");
  let out: Buffer<ArrayBufferLike> = Buffer.from(b64, "base64");

  // 2) INVERSE-stretch back to the source dimensions (cancels step 1 —
  //    true body proportions are preserved).
  const om = await sharp(out).metadata();
  if (om.width !== srcW || om.height !== srcH) {
    out = await sharp(out)
      .resize(srcW, srcH, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();
  }

  // 3) EDGE-LOCK — repair any residual re-framing by restoring the
  //    original border band with a feathered blend.
  let edgeLockApplied = false;
  if (opts.edgeLock !== false) {
    const rgbOrig = await sharp(srcBuf)
      .removeAlpha()
      .toColourspace("srgb")
      .png()
      .toBuffer();
    if (await detectReframe(out, rgbOrig, srcW, srcH)) {
      const frame = await buildFeatheredFrame(rgbOrig, srcW, srcH);
      out = await sharp(out)
        .composite([{ input: frame, left: 0, top: 0, blend: "over" as const }])
        .png({ quality: 92 })
        .toBuffer();
      edgeLockApplied = true;
    }
  }

  return { buffer: out, width: srcW, height: srcH, canvas, edgeLockApplied };
}
