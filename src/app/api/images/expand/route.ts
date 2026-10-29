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

interface ExpandBody {
  sourcePath: string;
  direction?: "all" | "left" | "right" | "top" | "bottom";
  percentage?: number;
}

/**
 * POST /api/images/expand
 *
 * Image expansion (outpainting) — extends the canvas beyond the original
 * frame. Tries AI first (z-ai) for natural scene continuation, falls
 * back to sharp mirror+blur if z-ai is unavailable or rate-limited.
 *
 * AI mode: z-ai generates a wider version of the scene — real outpainting
 * that continues the photo naturally (extends the room, sky, body, etc.)
 *
 * Fallback mode: sharp extends the canvas with mirrored+blurred edge
 * pixels. Less natural but works 100% of the time.
 */
/**
 * POST — wrapped with the global processing lock to serialize heavy
 * operations and avoid the platform's ResourceExhausted error.
 */
export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("expand")) {
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
  const body = (await req.json().catch(() => ({}))) as ExpandBody;
  if (!body.sourcePath) {
    return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  }
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
  } catch {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await fs.mkdir(RESULTS_ROOT, { recursive: true });

  const direction = body.direction ?? "all";
  const percentage = Math.min(50, Math.max(5, body.percentage ?? 20));

  // ===== TRY AI OUTPAINTING FIRST =====
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await ZAIModule.default.create();
    const sourceMeta = await sharp(body.sourcePath).metadata();
    const srcW = sourceMeta.width ?? 768;
    const srcH = sourceMeta.height ?? 1024;

    const ext = path.extname(body.sourcePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const b64 = (await fs.readFile(body.sourcePath)).toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;

    const dirHint = direction === "all"
      ? "ALL directions (top, bottom, left, right)"
      : `the ${direction.toUpperCase()} side only`;

    // === SMART OUTPAINTING: pick the largest z-ai size with closest aspect ratio ===
    // We don't require z-ai's output to be larger than the source — instead we
    // generate AI extension content, then composite the original on top with
    // feathered edges. This way:
    //   - Original stays crisp (subject preserved at full quality)
    //   - Surrounding area is AI-generated (natural continuation: hair, body, scene)
    //   - Feathered edges hide the seam between original and AI
    // Sort by total pixel count (largest first), then pick closest aspect ratio
    const targetRatio = (function() {
      const horiz = direction === "all" || direction === "left" || direction === "right";
      const vert = direction === "all" || direction === "top" || direction === "bottom";
      const factor = 1 + (percentage / 100) * (direction === "all" ? 2 : 1);
      const dW = horiz ? srcW * factor : srcW;
      const dH = vert ? srcH * factor : srcH;
      return dW / dH;
    })();
    // Pick the LARGEST supported size whose aspect ratio is closest to the target
    // (we want maximum pixels from z-ai, then we'll upscale via sharp)
    const supported = ["1024x1024","768x1344","864x1152","1344x768","1152x864","1440x720","720x1440"];
    let bestSize = supported[0], bestScore = -Infinity;
    for (const s of supported) {
      const [sw, sh] = s.split("x").map(Number);
      const pixels = sw * sh;
      const ratioDiff = Math.abs(sw / sh - targetRatio);
      // Score = pixels (bigger better) - ratio diff * 5M (heavily penalize bad ratio)
      const score = pixels - ratioDiff * 5_000_000;
      if (score > bestScore) { bestScore = score; bestSize = s; }
    }

    const prompt = `TRUE Outpainting — extend this photograph's scene beyond the original camera frame, on ${dirHint}.

CRITICAL: The new content MUST be a NATURAL CONTINUATION of what's in the photo:
  • If there's a person → extend their body, clothing, hair (same colors, same pose, same lighting)
  • If there's a room → extend the same room (same walls, floor, furniture, lighting, shadows)
  • If there's a sky/landscape → extend the same sky (same weather, colors, horizon, gradient)
  • Match lighting direction, color temperature, shadows, grain, and depth of field exactly
  • Continue hair strands, fabric folds, body curves naturally beyond the frame

DO NOT:
  • Add new objects or people that don't exist in the original
  • Replace the background with a different scene
  • Add frames, borders, watermarks, or visible edges
  • Change the subject's identity, clothing, or pose
  • Generate any text or logos

RESULT: A seamless wider photograph. The viewer should not be able to tell where the original borders were.`;

    const editResponse = await (zai.images.generations.edit as (opts: unknown) => Promise<{ data?: Array<{ base64?: string }> }>)({
      prompt,
      images: [{ url: dataUrl }],
      size: bestSize as never,
    });
    const imageBase64 = editResponse.data?.[0]?.base64;
    if (!imageBase64) throw new Error("No image returned from AI");

    const aiBuffer = Buffer.from(imageBase64, "base64");
    const aiMeta = await sharp(aiBuffer).metadata();
    const aiW = aiMeta.width ?? 1024;
    const aiH = aiMeta.height ?? 1024;

    // === Calculate target canvas dimensions (source + extensions) ===
    const extTop = (direction === "all" || direction === "top") ? Math.round(srcH * (percentage / 100)) : 0;
    const extBottom = (direction === "all" || direction === "bottom") ? Math.round(srcH * (percentage / 100)) : 0;
    const extLeft = (direction === "all" || direction === "left") ? Math.round(srcW * (percentage / 100)) : 0;
    const extRight = (direction === "all" || direction === "right") ? Math.round(srcW * (percentage / 100)) : 0;
    const targetW = srcW + extLeft + extRight;
    const targetH = srcH + extTop + extBottom;

    // === Composite pipeline ===
    // 1. Resize AI image to cover targetW x targetH (center crop)
    // 2. Composite original (with feathered edges) on top, centered at (extLeft, extTop)
    let resultBuf: Buffer;
    if (aiW * aiH >= srcW * srcH * 1.05) {
      // AI image is meaningfully larger than source — use AI directly (small source case)
      resultBuf = aiBuffer;
    } else {
      // AI image is same/smaller than source — use as background + composite original on top
      const featherRadius = Math.max(8, Math.round(Math.min(srcW, srcH) * 0.04));

      // Step 1: Resize AI to cover target canvas (smart cover-fit, center crop)
      const aiResized = await sharp(aiBuffer)
        .resize(targetW, targetH, { fit: "cover", position: "center" })
        .png()
        .toBuffer();

      // Step 2: Create feathered alpha mask for the original
      // White rectangle inset by featherRadius, blurred to feather edges
      const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${srcW}" height="${srcH}">
  <rect width="${srcW}" height="${srcH}" fill="black"/>
  <rect x="${featherRadius}" y="${featherRadius}" width="${srcW - 2 * featherRadius}" height="${srcH - 2 * featherRadius}" fill="white"/>
</svg>`;
      const blurredMask = await sharp(Buffer.from(maskSvg))
        .blur(featherRadius)
        .png()
        .toBuffer();

      // Step 3: Apply blurred mask as alpha channel to the original
      const origFeathered = await sharp(body.sourcePath)
        .composite([{ input: blurredMask, blend: "dest-in" as const }])
        .png()
        .toBuffer();

      // Step 4: Composite feathered original on top of AI background
      resultBuf = await sharp(aiResized)
        .composite([{
          input: origFeathered,
          left: extLeft,
          top: extTop,
          blend: "over" as const,
        }])
        .png({ quality: 95 })
        .toBuffer();
    }

    const outName = `expanded-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, resultBuf);

    const resultMeta = await sharp(resultBuf).metadata();
    const method = (aiW * aiH >= srcW * srcH * 1.05) ? "ai-outpaint" : "ai-outpaint-composited";
    await logEvent({
      category: "system",
      message: `Expanded ${method} (${direction}, +${percentage}%): ${srcW}x${srcH} → ${resultMeta.width}x${resultMeta.height} (z-ai=${aiW}x${aiH})`,
    });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: resultMeta.width ?? srcW,
      height: resultMeta.height ?? srcH,
      size: resultBuf.length,
      method,
    });
  } catch (aiError) {
    console.warn("[/api/images/expand] AI failed, using sharp fallback:", aiError instanceof Error ? aiError.message : aiError);
  }

  // ===== SHARP FALLBACK: mirror + blur extension =====
  try {
    const meta = await sharp(body.sourcePath).metadata();
    const srcW = meta.width ?? 768;
    const srcH = meta.height ?? 1024;

    const extTop = (direction === "all" || direction === "top") ? Math.round(srcH * (percentage / 100)) : 0;
    const extBottom = (direction === "all" || direction === "bottom") ? Math.round(srcH * (percentage / 100)) : 0;
    const extLeft = (direction === "all" || direction === "left") ? Math.round(srcW * (percentage / 100)) : 0;
    const extRight = (direction === "all" || direction === "right") ? Math.round(srcW * (percentage / 100)) : 0;

    if (extTop === 0 && extBottom === 0 && extLeft === 0 && extRight === 0) {
      return NextResponse.json({ error: "No extension for this direction" }, { status: 400 });
    }

    const origBuf = await fs.readFile(body.sourcePath);

    // Build strips for each direction (mirror + heavy blur for seamless blend)
    const strips: Array<{ input: Buffer; left: number; top: number }> = [];
    const blurAmount = Math.max(20, Math.round(Math.min(srcW, srcH) * 0.05));

    if (extTop > 0) {
      const s = await sharp(origBuf)
        .extract({ left: 0, top: 0, width: srcW, height: Math.min(extTop, srcH) })
        .flip().blur(blurAmount).resize(srcW, extTop, { fit: "fill" }).png().toBuffer();
      strips.push({ input: s, left: extLeft, top: 0 });
    }
    if (extBottom > 0) {
      const s = await sharp(origBuf)
        .extract({ left: 0, top: Math.max(0, srcH - extBottom), width: srcW, height: Math.min(extBottom, srcH) })
        .flip().blur(blurAmount).resize(srcW, extBottom, { fit: "fill" }).png().toBuffer();
      strips.push({ input: s, left: extLeft, top: srcH + extTop });
    }
    if (extLeft > 0) {
      const s = await sharp(origBuf)
        .extract({ left: 0, top: 0, width: Math.min(extLeft, srcW), height: srcH })
        .flop().blur(blurAmount).resize(extLeft, srcH, { fit: "fill" }).png().toBuffer();
      strips.push({ input: s, left: 0, top: extTop });
    }
    if (extRight > 0) {
      const s = await sharp(origBuf)
        .extract({ left: Math.max(0, srcW - extRight), top: 0, width: Math.min(extRight, srcW), height: srcH })
        .flop().blur(blurAmount).resize(extRight, srcH, { fit: "fill" }).png().toBuffer();
      strips.push({ input: s, left: srcW + extLeft, top: extTop });
    }

    // Sample edge color for corner fills
    const stats = await sharp(origBuf).stats();
    const avgR = Math.round(stats.channels[0].mean);
    const avgG = Math.round(stats.channels[1].mean);
    const avgB = Math.round(stats.channels[2].mean);

    let pipeline = sharp(origBuf).extend({
      top: extTop, bottom: extBottom, left: extLeft, right: extRight,
      background: { r: avgR, g: avgG, b: avgB, alpha: 1 },
    });

    if (strips.length > 0) {
      pipeline = pipeline.composite(strips.map((s) => ({
        input: s.input, left: s.left, top: s.top, blend: "over" as const,
      })));
    }

    // Place original on top
    pipeline = pipeline.composite([{
      input: origBuf, left: extLeft, top: extTop, blend: "over" as const,
    }]);

    const resultBuf = await pipeline.png({ quality: 95 }).toBuffer();
    const outName = `expanded-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, resultBuf);

    const resultMeta = await sharp(resultBuf).metadata();
    await logEvent({
      category: "system",
      message: `Expanded sharp (${direction}, +${percentage}%): ${srcW}x${srcH} → ${resultMeta.width}x${resultMeta.height}`,
    });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: resultMeta.width ?? (srcW + extLeft + extRight),
      height: resultMeta.height ?? (srcH + extTop + extBottom),
      size: resultBuf.length,
      method: "sharp-mirror-blur-extend",
    });
  } catch (e) {
    await logEvent({
      category: "tryon", level: "error",
      message: "Expand failed (both AI + sharp)",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Expand failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
