import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
import { aiEditFrameLocked } from "@/lib/ai-image-edit";
import { tryAcquireProcessingLock, releaseProcessingLock, getProcessingStatus } from "@/lib/processing-lock";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");
interface FaceRetouchBody { sourcePath: string; smoothness?: number; }
/**
 * POST — wrapped with the global processing lock to serialize heavy
 * operations and avoid the platform's ResourceExhausted error.
 */
export async function POST(req: NextRequest) {
  if (!tryAcquireProcessingLock("face-retouch")) {
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
  const body = (await req.json().catch(() => ({}))) as FaceRetouchBody;
  if (!body.sourcePath) return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  try { body.sourcePath = await resolveFilePath(body.sourcePath); } catch { return NextResponse.json({ error: "Source not found" }, { status: 404 }); }
  await fs.mkdir(RESULTS_ROOT, { recursive: true });
  const smoothness = Math.min(100, Math.max(0, body.smoothness ?? 30));
  try {
    const sourceMeta = await sharp(body.sourcePath).metadata();
    const srcW = sourceMeta.width ?? 768;
    const srcH = sourceMeta.height ?? 1024;
    const intensity = smoothness < 25 ? "subtle" : smoothness < 60 ? "moderate" : "strong";
    const prompt = `Retouch the face in this photograph with ${intensity} skin smoothing (smoothness level: ${smoothness}%).

YOUR JOB:
1. Smooth the skin on the face — reduce blemishes, acne, scars, spots, wrinkles
2. Even out skin tone — remove redness, sallowness, uneven patches
3. Reduce shine/oiliness on the skin
4. Keep facial features CRISP — eyes, eyebrows, nose, mouth, hair must remain sharp and detailed
5. Preserve the person's identity — same face shape, same eye color, same expression

CRITICAL RULES:
- DO NOT change facial features, identity, or expression
- DO NOT apply plastic/waxy skin texture — keep it natural
- DO NOT smooth eyes, lips, eyebrows, hair, or background
- DO NOT change clothing, jewelry, or background
- DO NOT alter the composition or crop the image
- The skin should look NATURALLY clear, not artificially smooth

RESULT: A photo with clearer, more even skin but the same person, same features, same everything else.`;
    // Frame-locked AI edit: pre-fits the source to the closest supported
    // canvas aspect (no backend center-crop → NO edge loss), inverse-stretches
    // the result back to the exact source dimensions, and edge-locks the
    // border bands if the model re-framed. Buffer is already srcW x srcH.
    const result = await aiEditFrameLocked({ sourcePath: body.sourcePath, prompt, edgeLock: true });
    const buffer = result.buffer;
    const outName = `face-retouch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Face Retouched: ${srcW}x${srcH}, smoothness=${smoothness}, canvas=${result.canvas}, edgeLock=${result.edgeLockApplied}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: srcW, height: srcH, size: buffer.length, method: "ai-face-retouch", smoothness, canvas: result.canvas, edgeLockApplied: result.edgeLockApplied });
  } catch (e) {
    await logEvent({ category: "tryon", level: "error", message: "Face Retouch failed", details: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Face Retouch failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
