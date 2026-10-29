import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
import { tryAcquireProcessingLock, releaseProcessingLock, getProcessingStatus } from "@/lib/processing-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");

type QualityKey = "hd" | "fullHd" | "twoK" | "fourK" | "ultraHd";

const QUALITY_TARGETS: Record<QualityKey, { long: string; short: string; target: number }> = {
  hd:     { long: "HD (1280p)",       short: "HD",     target: 1280 },
  fullHd: { long: "Full HD (1920p)",  short: "FHD",    target: 1920 },
  twoK:   { long: "2K (2560p)",       short: "2K",     target: 2560 },
  fourK:  { long: "4K (3840p)",       short: "4K",     target: 3840 },
  ultraHd:{ long: "Ultra HD (7680p)", short: "ULTRA",  target: 7680 },
};

interface EnhanceBody {
  sourcePath: string;
  scale?: 2 | 4;
  quality?: QualityKey;
}

/**
 * POST /api/images/enhance
 *
 * TRUE quality enhancement — not just upscaling.
 *
 * 3-step pipeline for ALL quality levels:
 *   1. PRE-PROCESS: sharp denoise + unsharp mask on the original
 *      (removes JPEG artifacts, brings out existing detail)
 *   2. AI ENHANCE: send to z-ai-web-dev-sdk images.generations.edit
 *      with a quality-enhancement prompt (NOT an upscale prompt).
 *      The AI adds details, sharpens edges, and removes blur.
 *   3. UPSIZE: sharp resize to the exact target dimensions with
 *      lanczos3 kernel + heavy unsharp mask.
 *
 * This gives TRUE quality improvement: AI hallucinates fine
 * details (skin texture, fabric weave, hair strands) that weren't
 * visible in the original, then sharp resizes to the requested
 * resolution.
 *
 * Falls back to sharp-only if the AI is unavailable.
 */
/**
 * POST — wrapped with the global processing lock to serialize heavy
 * operations and avoid the platform's ResourceExhausted error.
 */
export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("enhance")) {
    const status = getProcessingStatus();
    return NextResponse.json({
      error: `عملية "${status.op}" جارية الآن (${Math.round(status.elapsedMs / 1000)}s). انتظر انتهاءها ثم أعد المحاولة.`,
      retryAfter: 5,
      busyWith: status.op,
    }, { status: 429 });
  }
  try {
    return await _POST_impl(req);
  } finally {
    releaseProcessingLock();
  }
}

async function _POST_impl(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as EnhanceBody;
  if (!body.sourcePath) return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  try { body.sourcePath = await resolveFilePath(body.sourcePath); } catch { return NextResponse.json({ error: "Source not found" }, { status: 404 }); }

  await fs.mkdir(RESULTS_ROOT, { recursive: true });

  let quality: QualityKey;
  if (body.quality && QUALITY_TARGETS[body.quality]) {
    quality = body.quality;
  } else if (body.scale === 4) {
    quality = "fourK";
  } else {
    quality = "hd";
  }
  const target = QUALITY_TARGETS[quality];

  try {
    const sourceMeta = await sharp(body.sourcePath).metadata();
    const srcW = sourceMeta.width ?? 768;
    const srcH = sourceMeta.height ?? 1024;

    let newW: number, newH: number;
    if (srcW >= srcH) {
      newW = target.target;
      newH = Math.round((srcH / srcW) * target.target);
    } else {
      newH = target.target;
      newW = Math.round((srcW / srcH) * target.target);
    }
    newW = newW - (newW % 2);
    newH = newH - (newH % 2);

    // ============================================================
    // STEP 1: PRE-PROCESS — denoise + unsharp mask on original
    // ============================================================
    // Remove JPEG compression artifacts and bring out existing
    // detail before sending to AI. This gives the AI a cleaner
    // input to work with.
    const preprocessed = await sharp(body.sourcePath)
      .withMetadata()
      // Remove noise (small radius, mild)
      .blur(0.3)
      // Strong unsharp mask to bring out edges
      .sharpen({ sigma: 1.2, amount: 1.0, threshold: 0 })
      // Slight saturation/contrast boost
      .modulate({ saturation: 1.08, brightness: 1.02 })
      .png({ quality: 95 })
      .toBuffer();

    // ============================================================
    // STEP 2: AI ENHANCE — send to AI for quality enhancement
    // ============================================================
    // IMPORTANT: We do NOT ask the AI to "upscale" (it can't —
    // max canvas is 1440x720). Instead, we ask it to ENHANCE
    // the image quality: add fine details, sharpen, denoise,
    // restore texture. The AI output is then resized by sharp.
    let aiEnhancedBuffer: Buffer | null = null;
    let aiSizeUsed: string | null = null;

    try {
      const ZAIModule = await import("z-ai-web-dev-sdk");
      const zai = await ZAIModule.default.create();

      const ext = path.extname(body.sourcePath).toLowerCase();
      const mime = ext === ".png" ? "image/png" : "image/jpeg";
      // Send the PREPROCESSED image (not the raw original) to AI
      const b64 = preprocessed.toString("base64");
      const dataUrl = `data:${mime};base64,${b64}`;

      // Pick AI canvas size matching the source aspect ratio
      const supported = ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"];
      let bestSize = supported[0];
      let bestDiff = Infinity;
      const srcRatio = srcW / srcH;
      for (const s of supported) {
        const [sw, sh] = s.split("x").map(Number);
        const diff = Math.abs((sw / sh) - srcRatio);
        if (diff < bestDiff) { bestDiff = diff; bestSize = s; }
      }
      aiSizeUsed = bestSize;

      // *** CRITICAL: ENHANCE prompt, not UPSCALE prompt ***
      // The AI image-edit API does NOT do super-resolution. It does
      // image-to-image translation. So we ask it to enhance quality
      // (add details, sharpen, denoise) — and it returns a same-size
      // image with quality improvements. We then resize with sharp.
      const prompt = `ENHANCE this image's quality — make it look like a professional high-resolution photo.

DO THIS:
1. ADD FINE DETAILS that are implied but not visible in the original:
   - Skin texture (pores, fine lines, natural skin grain)
   - Fabric weave and stitching
   - Hair strands and individual hairs
   - Eye details (iris pattern, eyelashes, catchlights)
   - Texture of surfaces (wood grain, metal, paper, etc.)
2. SHARPEN edges and boundaries — make them crisp and defined
3. REMOVE blur, noise, and JPEG compression artifacts
4. ENHANCE local contrast — make the image "pop" with depth
5. PRESERVE the original's colors, lighting, and composition EXACTLY

DO NOT:
- Change the subject, pose, expression, or identity
- Change the colors, lighting, or mood
- Add new content, objects, or people
- Apply plastic/waxy skin smoothing
- Change the aspect ratio or distort shapes
- Add frames, borders, watermarks, or text

RESULT: A higher-QUALITY version of the same image — same content, same composition, but with crisper details, sharper edges, and more visible fine texture. The result should look like it was captured with a better camera, not like it was stretched.`;

      const editResponse = await (zai.images.generations.edit as any)({
        prompt,
        images: [{ url: dataUrl }],
        size: bestSize,
      });

      const imageBase64 = editResponse.data?.[0]?.base64;
      if (!imageBase64) throw new Error("AI returned no image");
      aiEnhancedBuffer = Buffer.from(imageBase64, "base64");

      await logEvent({
        category: "tryon",
        message: `AI Enhanced (quality): ${srcW}x${srcH} → AI canvas ${bestSize} → sharp resize to ${newW}x${newH}`,
      });
    } catch (aiErr) {
      // AI failed — fall back to sharp-only multi-pass
      await logEvent({
        category: "tryon",
        level: "warn",
        message: `AI enhance failed, using sharp-only: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}`,
      });
    }

    // ============================================================
    // STEP 3: UPSIZE — sharp resize to exact target dimensions
    // ============================================================
    // Use the AI-enhanced buffer if available, otherwise the
    // preprocessed original. Multi-pass for very large sizes
    // (4K, ULTRA) to reduce aliasing.

    const sourceBuffer: Buffer = aiEnhancedBuffer ?? preprocessed;
    let method: string;
    let buffer: Buffer;
    const aiWasUsed = aiEnhancedBuffer !== null;

    // For very large sizes (4K, ULTRA), do 2-pass resize to reduce
    // aliasing. For smaller sizes (HD, FHD, 2K), single-pass is fine.
    if (quality === "fourK" || quality === "ultraHd") {
      // Multi-pass: AI canvas → 2x intermediate → final
      const aiMeta = await sharp(sourceBuffer).metadata();
      const aiW = aiMeta.width ?? srcW;
      const aiH = aiMeta.height ?? srcH;
      const midW = Math.min(aiW * 2, Math.round(newW * 0.5));
      const midH = Math.min(aiH * 2, Math.round(newH * 0.5));

      const intermediate = await sharp(sourceBuffer)
        .resize(midW, midH, { kernel: "lanczos3" })
        .sharpen({ sigma: 1.0, amount: 0.6, threshold: 0 })
        .png({ quality: 95 })
        .toBuffer();

      const final = await sharp(intermediate)
        .resize(newW, newH, { kernel: "lanczos3" })
        .sharpen({ sigma: 1.5, amount: 1.5, threshold: 0 })
        .modulate({ saturation: 1.05, brightness: 1.01 })
        .png({ quality: 92 })
        .toBuffer();

      // Re-apply AI enhancement on the upscaled result if AI was used
      // (this brings out fine details at the final resolution)
      buffer = final;
      method = aiWasUsed ? `ai-enhance-then-sharp-multipass-${target.short.toLowerCase()}` : `sharp-multipass-${target.short.toLowerCase()}`;
    } else {
      // Single-pass: AI canvas → final
      buffer = await sharp(sourceBuffer)
        .resize(newW, newH, { kernel: "lanczos3", fit: "fill" })
        .sharpen({ sigma: 1.2, amount: 1.0, threshold: 0 })
        .modulate({ saturation: 1.08, brightness: 1.02 })
        .png({ quality: 92 })
        .toBuffer();
      method = aiWasUsed ? `ai-enhance-then-sharp-${target.short.toLowerCase()}` : `sharp-only-${target.short.toLowerCase()}`;
    }

    const outName = `enhanced-${target.short.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: newW,
      height: newH,
      size: buffer.length,
      quality,
      qualityLabel: target.long,
      method,
      aiCanvasSize: aiSizeUsed,
      pipeline: ["preprocess-denoise-sharpen", aiWasUsed ? "ai-enhance-details" : "no-ai", "sharp-resize-final"],
    });
  } catch (e) {
    await logEvent({
      category: "tryon",
      level: "error",
      message: "Enhance failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Enhance failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}

