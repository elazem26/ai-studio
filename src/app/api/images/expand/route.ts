import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
import { pickAiCanvasSize } from "@/lib/ai-image-edit";
import { tryAcquireProcessingLock, releaseProcessingLock, getProcessingStatus } from "@/lib/processing-lock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");

interface ExpandBody {
  sourcePath: string;
  direction?: "all" | "left" | "right" | "top" | "bottom";
  percentage?: number;
}

/**
 * POST /api/images/expand
 *
 * SEAMLESS outpainting — "pad → AI → merge" technique.
 *
 * OLD approach (broken): sent the ORIGINAL alone and asked the AI to
 * "extend the scene". The model returned whatever canvas it wanted at
 * its own framing, then the original was pasted on top of a MISMATCHED
 * AI background with a huge feather → the result looked like two
 * stacked layers (photo floating inside a frame) and sometimes like a
 * crop (AI canvas smaller than the requested target).
 *
 * NEW approach (unified, single layer):
 *   1. Build the target canvas (source + extensions) and PRE-FILL the
 *      margin with mirrored+blurred continuation of the original.
 *      The original already sits at its final position → the AI input
 *      IS the final composition, just with a rough margin.
 *   2. Fit that canvas to the closest supported AI size (stretch).
 *   3. AI edit: "keep the center exactly, replace only the blurry
 *      margin with a sharp natural continuation".
 *   4. Stretch the AI output back to the exact target dimensions.
 *   5. Composite the CRISP original on top with a THIN feathered seam
 *      (the background now matches by construction → the seam is
 *      invisible → ONE unified photograph, no frame, no border).
 *
 * The output dimensions are ALWAYS exactly targetW x targetH — the
 * operation can never crop instead of expanding.
 */
export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("expand")) {
    const status = getProcessingStatus();
    const busyMsg = `عملية "${status.op}" جارية الآن (${Math.round(status.elapsedMs / 1000)}s). انتظر انتهاءها ثم أعد المحاولة.`;
    return NextResponse.json({
      error: busyMsg,
      message: busyMsg,
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
  const body = (await req.json().catch(() => ({}))) as ExpandBody;
  if (!body.sourcePath) {
    return NextResponse.json({ error: "Missing sourcePath", message: "Missing sourcePath" }, { status: 400 });
  }
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
  } catch {
    // NOTE: include BOTH `error` and `message` — legacy clients read
    // `d.message` and would otherwise show an empty error toast.
    return NextResponse.json({ error: "Source not found", message: "Source not found" }, { status: 404 });
  }

  await fs.mkdir(RESULTS_ROOT, { recursive: true });

  const direction = body.direction ?? "all";
  const percentage = Math.min(50, Math.max(5, body.percentage ?? 20));

  const meta = await sharp(body.sourcePath).metadata();
  const srcW = meta.width ?? 768;
  const srcH = meta.height ?? 1024;

  const extTop = (direction === "all" || direction === "top") ? Math.round(srcH * (percentage / 100)) : 0;
  const extBottom = (direction === "all" || direction === "bottom") ? Math.round(srcH * (percentage / 100)) : 0;
  const extLeft = (direction === "all" || direction === "left") ? Math.round(srcW * (percentage / 100)) : 0;
  const extRight = (direction === "all" || direction === "right") ? Math.round(srcW * (percentage / 100)) : 0;

  if (extTop === 0 && extBottom === 0 && extLeft === 0 && extRight === 0) {
    return NextResponse.json({ error: "No extension for this direction", message: "No extension for this direction" }, { status: 400 });
  }

  const targetW = srcW + extLeft + extRight;
  const targetH = srcH + extTop + extBottom;
  const origBuf = await fs.readFile(body.sourcePath);

  // ==================================================================
  // STEP 1 — build the padded base canvas at the exact target size.
  //   • bg: cover-scaled blurred copy of the original fills the whole
  //     canvas (plausible colors everywhere, including the corners).
  //   • strips: mirrored + blurred edge continuations give the AI a
  //     directional hint (continue the floor, the wall, the body…).
  //   • the original is pasted at its final position.
  // ==================================================================
  const paddedBase = await buildPaddedBase(
    origBuf, srcW, srcH, targetW, targetH, extLeft, extTop,
    { top: extTop, bottom: extBottom, left: extLeft, right: extRight },
    { stripBlur: Math.max(12, Math.round(Math.min(srcW, srcH) * 0.022)), featherStrips: true, cornerMirror: true }
  );

  // ==================================================================
  // STEP 2-5 — AI refines the margin, then we merge into ONE image.
  // Includes a structure guard: if the model re-imagines the CENTER
  // (non-deterministic), retry once; if it still diverges, fall back
  // to the deterministic mirror continuation below.
  // ==================================================================
  try {
    const canvas = pickAiCanvasSize(targetW, targetH);
    const [cw, ch] = canvas.split("x").map(Number);

    // Stretch the padded base to the exact AI canvas aspect (the same
    // transform is inverted after the edit, so geometry round-trips).
    const fitted = await sharp(paddedBase)
      .resize(cw, ch, { fit: "fill", kernel: "lanczos3" })
      .png()
      .toBuffer();

    const dirHint = direction === "all"
      ? "on ALL sides (top, bottom, left, right)"
      : `on the ${direction.toUpperCase()} side only`;

    const prompt = `OUTPAINTING REPAIR — this image is a photograph that was mechanically pre-extended by MIRRORING its edges ${dirHint}. The CENTER is the real photograph. The OUTER REGION contains obvious mirror artifacts: flipped/duplicated content, ghost reflections and smeared patches.

YOUR JOB:
1. KEEP the center photograph EXACTLY as it is — same person, same pose, same body proportions, same colors, same lighting, pixel-identical. Do not zoom, crop, shift, or rescale it.
2. REBUILD the entire outer region into a SHARP, DETAILED, natural continuation of the scene — as if the camera had actually captured a wider view:
   • Remove every mirrored/flipped/ghost duplicate in the outer region and replace it with plausible, NEW, coherent content (continue the room, the floor, the walls, the decorations, the sky…).
   • If a body part (hair, shoulders, arms, dress) is cut by the inner frame → extend it outward with correct anatomy and proportions.
3. Match lighting direction, color temperature, shadows, grain, depth of field and perspective exactly.
4. The transition between center and outer region must be INVISIBLE — one single unified photograph. No seam, no frame, no border, no vignette, no watermark.

DO NOT: keep any mirrored/ghost content, blur the image, add new people or objects, change the person's identity/face/clothing, distort body proportions, or add any text.
RESULT: one seamless, uniformly sharp photograph where nobody can tell where the original frame was.`;

    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await ZAIModule.default.create();

    const runAiOnce = async (): Promise<Buffer> => {
      const editResponse = await (zai.images.generations.edit as (o: unknown) => Promise<{
        data?: Array<{ base64?: string }>;
      }>)({
        prompt,
        images: [{ url: `data:image/png;base64,${fitted.toString("base64")}` }],
        size: canvas,
      });
      const imageBase64 = editResponse.data?.[0]?.base64;
      if (!imageBase64) throw new Error("No image returned from AI");
      const aiBuffer = Buffer.from(imageBase64, "base64");

      // Inverse stretch back to the exact target canvas.
      let out = await sharp(aiBuffer)
        .resize(targetW, targetH, { fit: "fill", kernel: "lanczos3" })
        .png()
        .toBuffer();

      // Tone-match the AI canvas to the original inside the center region.
      // Edit models often shift global brightness/color slightly — without
      // this correction the crisp original composited on top would show as
      // a visible "card" (brightness step at the seam = the frame effect).
      out = await toneMatch(out, origBuf, extLeft, extTop, srcW, srcH);

      // Second pass — equalize the margin RING around the original so the
      // AI-rendered margin meets the composited original with zero
      // brightness step (kills the faint "glass card" edge).
      out = await seamBlend(out, origBuf, targetW, targetH, extLeft, extTop, srcW, srcH);
      return out;
    };

    // Structure guard: the CENTER of the AI output must still be the
    // original photograph (same scene, same framing).
    const centerDiverged = async (out: Buffer): Promise<boolean> => {
      const center = await sharp(out)
        .extract({ left: extLeft, top: extTop, width: srcW, height: srcH })
        .toBuffer();
      const d = await structuralDiff(center, origBuf);
      return d > 0.55;
    };

    let aiResized = await runAiOnce();
    if (await centerDiverged(aiResized)) {
      await logEvent({ category: "system", level: "warn", message: "Expand: AI re-imagined the center — retrying once" });
      aiResized = await runAiOnce();
      if (await centerDiverged(aiResized)) {
        throw new Error("AI re-imagined the center twice — using deterministic fallback");
      }
    }

    // Merge: crisp original on top with a moderate feathered seam —
    // narrow enough to never double-expose, wide enough (with the
    // tone-equalized margin) to hide any residual step.
    const seam = Math.min(48, Math.max(24, Math.round(Math.min(targetW, targetH) * 0.025)));
    const featheredOrig = await buildFeatheredCenter(
      origBuf, srcW, srcH, seam
    );

    const resultBuf = await sharp(aiResized)
      .composite([{
        input: featheredOrig,
        left: extLeft,
        top: extTop,
        blend: "over" as const,
      }])
      .png({ quality: 95 })
      .toBuffer();

    const outName = `expanded-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, resultBuf);

    const resultMeta = await sharp(resultBuf).metadata();
    await logEvent({
      category: "system",
      message: `Expanded seamless (pad→ai→merge, ${direction}, +${percentage}%): ${srcW}x${srcH} → ${resultMeta.width}x${resultMeta.height} (canvas=${canvas})`,
    });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: resultMeta.width ?? targetW,
      height: resultMeta.height ?? targetH,
      size: resultBuf.length,
      method: "ai-outpaint-seamless",
      canvas,
    });
  } catch (aiError) {
    console.warn("[/api/images/expand] AI failed, using sharp fallback:", aiError instanceof Error ? aiError.message : aiError);
  }

  // ==================================================================
  // FALLBACK — deterministic SHARP mirror continuation (no AI).
  //
  // The OLD fallback blurred the mirrored strips (it was designed as
  // an AI *hint* canvas), which read as a broken result: a crisp photo
  // floating inside a heavily-blurred frame. As a FINAL RESULT the
  // continuation must be SHARP instead: reflect-padded content keeps
  // the original's textures, sharpness and colors, so the margin looks
  // like the camera actually captured more of the scene.
  //
  // featherStrips is deliberately FALSE here: the feather mask makes
  // each strip's CENTER transparent (only an edge ring stays opaque —
  // right for an AI hint, wrong for a final image). Plain hard paste
  // is seam-free by construction — reflect padding is pixel-continuous
  // across every strip/corner/original boundary — and strips+corners
  // cover the whole margin, so the background fill is fully hidden.
  // Never crops, never mis-sizes.
  // ==================================================================
  const fallbackBase = await buildPaddedBase(
    origBuf, srcW, srcH, targetW, targetH, extLeft, extTop,
    { top: extTop, bottom: extBottom, left: extLeft, right: extRight },
    { stripBlur: 0, featherStrips: false, cornerMirror: true, sharpMode: true }
  );
  const outName = `expanded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const outPath = path.join(RESULTS_ROOT, outName);
  await fs.writeFile(outPath, fallbackBase);

  const resultMeta = await sharp(fallbackBase).metadata();
  await logEvent({
    category: "system",
    message: `Expanded local (sharp mirror, ${direction}, +${percentage}%): ${srcW}x${srcH} → ${resultMeta.width}x${resultMeta.height}`,
  });

  return NextResponse.json({
    url: `/results/${outName}`,
    path: outPath,
    width: resultMeta.width ?? targetW,
    height: resultMeta.height ?? targetH,
    size: fallbackBase.length,
    method: "sharp-mirror-extend",
  });
}

/**
 * Build the padded working canvas at the exact target size:
 * blurred cover background (fills corners) + mirrored directional
 * strips (continuation hints, feathered so they blend into the
 * background without hard rectangle edges) + the original at its
 * final position.
 */
// Exported for the local fallback-quality test script (scripts/test-expand-fallback.ts)
export async function buildPaddedBase(
  origBuf: Buffer,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  extLeft: number,
  extTop: number,
  ext: { top: number; bottom: number; left: number; right: number },
  opts: { stripBlur: number; featherStrips: boolean; cornerMirror: boolean; sharpMode?: boolean }
): Promise<Buffer> {
  // Full-canvas plausible background: cover-fill. In AI-hint mode it is
  // heavily blurred (tells the model where to work); in sharpMode (the
  // deterministic fallback) it stays SHARP so the margin never reads as
  // a blurry frame. It is almost fully covered by strips+corners anyway.
  const bgPipeline = sharp(origBuf)
    .resize(targetW, targetH, { fit: "cover", position: "center" });
  const bg = await (opts.sharpMode
    ? bgPipeline
    : bgPipeline.blur(Math.max(24, Math.round(Math.min(srcW, srcH) * 0.06))))
    .modulate({ brightness: 0.99 })
    .png()
    .toBuffer();

  // Directional mirrored strips — continuation hints.
  // blur(<0.3) throws in sharp — guard so stripBlur 0 = fully SHARP
  // mirrored continuation (used by the deterministic fallback).
  const raw: Array<{ input: Buffer; left: number; top: number; w: number; h: number }> = [];
  const blurAmount = opts.stripBlur;
  const blurIfAny = (p: sharp.Sharp) => (blurAmount >= 0.3 ? p.blur(blurAmount) : p);

  if (ext.top > 0) {
    const s = await blurIfAny(sharp(origBuf)
      .extract({ left: 0, top: 0, width: srcW, height: Math.min(ext.top, srcH) })
      .flip()).resize(srcW, ext.top, { fit: "fill" }).png().toBuffer();
    raw.push({ input: s, left: extLeft, top: 0, w: srcW, h: ext.top });
  }
  if (ext.bottom > 0) {
    const s = await blurIfAny(sharp(origBuf)
      .extract({ left: 0, top: Math.max(0, srcH - ext.bottom), width: srcW, height: Math.min(ext.bottom, srcH) })
      .flip()).resize(srcW, ext.bottom, { fit: "fill" }).png().toBuffer();
    raw.push({ input: s, left: extLeft, top: srcH + extTop, w: srcW, h: ext.bottom });
  }
  if (ext.left > 0) {
    const s = await blurIfAny(sharp(origBuf)
      .extract({ left: 0, top: 0, width: Math.min(ext.left, srcW), height: srcH })
      .flop()).resize(ext.left, srcH, { fit: "fill" }).png().toBuffer();
    raw.push({ input: s, left: 0, top: extTop, w: ext.left, h: srcH });
  }
  if (ext.right > 0) {
    const s = await blurIfAny(sharp(origBuf)
      .extract({ left: Math.max(0, srcW - ext.right), top: 0, width: Math.min(ext.right, srcW), height: srcH })
      .flop()).resize(ext.right, srcH, { fit: "fill" }).png().toBuffer();
    raw.push({ input: s, left: srcW + extLeft, top: extTop, w: ext.right, h: srcH });
  }

  // Corner patches — 180° rotation of the original's corresponding
  // corner quadrants (standard mirror-continue), so NO corner is left
  // as flat/blurry filler.
  if (opts.cornerMirror) {
    const corners: Array<{ srcLeft: number; srcTop: number; w: number; h: number; dstLeft: number; dstTop: number }> = [];
    if (ext.left > 0 && ext.top > 0) corners.push({ srcLeft: 0, srcTop: 0, w: Math.min(ext.left, srcW), h: Math.min(ext.top, srcH), dstLeft: 0, dstTop: 0 });
    if (ext.right > 0 && ext.top > 0) corners.push({ srcLeft: Math.max(0, srcW - Math.min(ext.right, srcW)), srcTop: 0, w: Math.min(ext.right, srcW), h: Math.min(ext.top, srcH), dstLeft: srcW + extLeft, dstTop: 0 });
    if (ext.left > 0 && ext.bottom > 0) corners.push({ srcLeft: 0, srcTop: Math.max(0, srcH - Math.min(ext.bottom, srcH)), w: Math.min(ext.left, srcW), h: Math.min(ext.bottom, srcH), dstLeft: 0, dstTop: srcH + extTop });
    if (ext.right > 0 && ext.bottom > 0) corners.push({ srcLeft: Math.max(0, srcW - Math.min(ext.right, srcW)), srcTop: Math.max(0, srcH - Math.min(ext.bottom, srcH)), w: Math.min(ext.right, srcW), h: Math.min(ext.bottom, srcH), dstLeft: srcW + extLeft, dstTop: srcH + extTop });
    for (const c of corners) {
      const patchPipeline = sharp(origBuf)
        .extract({ left: c.srcLeft, top: c.srcTop, width: c.w, height: c.h })
        .rotate(180);
      const cornerBlur = Math.round(opts.stripBlur * 0.5);
      const patch = await (cornerBlur >= 0.3 ? patchPipeline.blur(cornerBlur) : patchPipeline)
        .png().toBuffer();
      raw.push({ input: patch, left: c.dstLeft, top: c.dstTop, w: c.w, h: c.h });
    }
  }

  // Feather every strip's edges so they melt into the background
  // (no hard rectangle borders in the AI's input preview).
  const strips: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const s of raw) {
    strips.push({
      input: opts.featherStrips ? await featherEdges(s.input, s.w, s.h) : s.input,
      left: s.left,
      top: s.top,
    });
  }

  // NOTE: paste the original HARD into the draft. A feathered paste
  // (tried) destabilizes the model into mosaics/artstyles — the hard
  // edge reads as "photo on canvas" which the model preserves.
  return sharp(bg)
    .composite([
      ...strips.map((s) => ({ input: s.input, left: s.left, top: s.top, blend: "over" as const })),
      { input: origBuf, left: extLeft, top: extTop, blend: "over" as const },
    ])
    .png()
    .toBuffer();
}

// Exported for the local fallback-quality test script
export async function featherEdges(
  buf: Buffer,
  w: number,
  h: number
): Promise<Buffer> {
  const f = Math.max(6, Math.round(Math.min(w, h) * 0.12));
  const blur = Math.max(4, Math.round(f * 0.7));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect x="${-blur * 2}" y="${-blur * 2}" width="${w + blur * 4}" height="${h + blur * 4}" fill="white"/>
  <rect x="${f}" y="${f}" width="${Math.max(1, w - 2 * f)}" height="${Math.max(1, h - 2 * f)}" fill="black"/>
</svg>`;
  const maskGray = await sharp(Buffer.from(svg)).blur(blur).greyscale().raw().toBuffer();
  const rgb = await sharp(buf).removeAlpha().toColourspace("srgb").png().toBuffer();
  return sharp(rgb)
    .joinChannel(maskGray, { raw: { width: w, height: h, channels: 1 } })
    .png()
    .toBuffer();
}

// Exported for the local fallback-quality test script
export async function buildFeatheredCenter(
  origBuf: Buffer,
  w: number,
  h: number,
  seam: number
): Promise<Buffer> {
  const blur = Math.max(4, Math.round(seam * 0.8));
  // White over-extends past the canvas so the OUTER border of the
  // original stays fully opaque; only the inner edge feathers.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect x="${-blur * 2}" y="${-blur * 2}" width="${w + blur * 4}" height="${h + blur * 4}" fill="white"/>
  <rect x="${seam}" y="${seam}" width="${Math.max(1, w - 2 * seam)}" height="${Math.max(1, h - 2 * seam)}" fill="black"/>
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

/**
 * Linear tone-match of the AI canvas to the original, measured inside
 * the center region. out = a*v + b per channel, where a = origStd/aiStd
 * (clamped) and b aligns the means. Removes the brightness/color step
 * at the merge seam so the composited original never reads as a card.
 */
async function toneMatch(
  aiBuf: Buffer,
  origBuf: Buffer,
  left: number,
  top: number,
  w: number,
  h: number
): Promise<Buffer> {
  try {
    const origStats = await sharp(origBuf).stats();
    const aiStats = await sharp(aiBuf)
      .extract({ left, top, width: w, height: h })
      .stats();
    const a: number[] = [];
    const b: number[] = [];
    for (let c = 0; c < 3; c++) {
      const om = origStats.channels[c].mean;
      const os = Math.max(8, origStats.channels[c].stdev);
      const am = aiStats.channels[c].mean;
      const as = Math.max(8, aiStats.channels[c].stdev);
      const scale = Math.min(1.12, Math.max(0.89, os / as));
      a.push(scale);
      b.push(om - scale * am);
    }
    // Skip if the shift is negligible (< 1.5 mean levels).
    const maxShift = Math.max(Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]));
    if (maxShift < 1.5) return aiBuf;
    return sharp(aiBuf).linear(a, b).png().toBuffer();
  } catch {
    return aiBuf;
  }
}

/**
 * Equalize the margin ring around the original: measure the AI margin
 * just OUTSIDE the original rectangle, compare it with the original's
 * overall tone, and apply the residual shift ONLY in a feathered ring
 * zone. This removes the local brightness step at the merge seam that
 * a single global correction cannot fix (model brightens center more
 * than margin).
 */
async function seamBlend(
  aiBuf: Buffer,
  origBuf: Buffer,
  targetW: number,
  targetH: number,
  extLeft: number,
  extTop: number,
  srcW: number,
  srcH: number
): Promise<Buffer> {
  try {
    const band = Math.min(120, Math.max(40, Math.round(Math.min(srcW, srcH) * 0.06)));

    const outer = {
      left: Math.max(0, extLeft - band),
      top: Math.max(0, extTop - band),
      width: Math.min(targetW - Math.max(0, extLeft - band), srcW + 2 * band),
      height: Math.min(targetH - Math.max(0, extTop - band), srcH + 2 * band),
    };
    const outerStats = await sharp(aiBuf).extract(outer).stats();
    const centerStats = await sharp(aiBuf)
      .extract({ left: extLeft, top: extTop, width: srcW, height: srcH })
      .stats();
    // Target = the original's own BORDER RING mean (what the margin
    // should match at the seam), not the whole-image mean.
    const innerBand = Math.min(band, Math.floor(Math.min(srcW, srcH) / 4));
    const inner = {
      left: innerBand,
      top: innerBand,
      width: Math.max(1, srcW - 2 * innerBand),
      height: Math.max(1, srcH - 2 * innerBand),
    };
    const wholeStats = await sharp(origBuf).stats();
    const innerStats = await sharp(origBuf).extract(inner).stats();

    const outerArea = outer.width * outer.height;
    const ringArea = Math.max(1, outerArea - srcW * srcH);
    const origRingArea = Math.max(1, srcW * srcH - inner.width * inner.height);
    const b: number[] = [];
    for (let c = 0; c < 3; c++) {
      const outerMean = outerStats.channels[c].mean;
      const centerMean = centerStats.channels[c].mean;
      const aiRingMean = (outerMean * outerArea - centerMean * srcW * srcH) / ringArea;
      const wholeMean = wholeStats.channels[c].mean;
      const innerMean = innerStats.channels[c].mean;
      const origRingMean = (wholeMean * srcW * srcH - innerMean * inner.width * inner.height) / origRingArea;
      b.push(origRingMean - aiRingMean);
    }
    const maxShift = Math.max(Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]));
    if (maxShift < 1.5) return aiBuf;

    const shifted = await sharp(aiBuf).linear([1, 1, 1], b).png().toBuffer();
    // Mask: white ring around the original rect (outer rect expanded by
    // 2×band minus the original rect), feathered; everything far away
    // stays untouched to avoid creating a reverse step deeper out.
    const grow = band * 2;
    const fx = Math.max(0, extLeft - grow);
    const fy = Math.max(0, extTop - grow);
    const fw = Math.min(targetW - fx, srcW + 2 * grow);
    const fh = Math.min(targetH - fy, srcH + 2 * grow);
    const blur = Math.max(12, Math.round(band * 0.5));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
  <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="white"/>
  <rect x="${extLeft}" y="${extTop}" width="${srcW}" height="${srcH}" fill="black"/>
  <rect x="0" y="0" width="${targetW}" height="${fy}" fill="black"/>
  <rect x="0" y="${fy + fh}" width="${targetW}" height="${Math.max(0, targetH - fy - fh)}" fill="black"/>
  <rect x="0" y="${fy}" width="${fx}" height="${fh}" fill="black"/>
  <rect x="${fx + fw}" y="${fy}" width="${Math.max(0, targetW - fx - fw)}" height="${fh}" fill="black"/>
</svg>`;
    const maskGray = await sharp(Buffer.from(svg)).blur(blur).greyscale().raw().toBuffer();
    const shiftedFrame = await sharp(shifted)
      .joinChannel(maskGray, { raw: { width: targetW, height: targetH, channels: 1 } })
      .png()
      .toBuffer();
    return sharp(aiBuf)
      .composite([{ input: shiftedFrame, left: 0, top: 0, blend: "over" as const }])
      .png()
      .toBuffer();
  } catch {
    return aiBuf;
  }
}

/**
 * Normalized structural difference between two same-size images
 * (grayscale, mean/std normalized → invariant to brightness/color,
 * sensitive to content/framing changes). Used by the center guard.
 */
async function structuralDiff(aBuf: Buffer, bBuf: Buffer): Promise<number> {
  try {
    const W = 64, H = 64;
    const a = await sharp(aBuf).greyscale().resize(W, H, { fit: "fill" }).raw().toBuffer();
    const b = await sharp(bBuf).greyscale().resize(W, H, { fit: "fill" }).raw().toBuffer();
    const norm = (raw: Buffer): Float32Array | null => {
      let mean = 0;
      for (let i = 0; i < raw.length; i++) mean += raw[i];
      mean /= raw.length;
      let vr = 0;
      for (let i = 0; i < raw.length; i++) { const d = raw[i] - mean; vr += d * d; }
      const std = Math.sqrt(vr / raw.length);
      if (std < 4) return null;
      const out = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = (raw[i] - mean) / std;
      return out;
    };
    const na = norm(a);
    const nb = norm(b);
    if (!na || !nb) return 0;
    let sum = 0;
    for (let i = 0; i < na.length; i++) sum += Math.abs(na[i] - nb[i]);
    return sum / na.length;
  } catch {
    return 0;
  }
}
