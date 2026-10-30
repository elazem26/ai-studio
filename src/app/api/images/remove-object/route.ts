import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
import { aiEditFrameLocked } from "@/lib/ai-image-edit";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.sourcePath) return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  try { body.sourcePath = await resolveFilePath(body.sourcePath); } catch { return NextResponse.json({ error: "Source not found" }, { status: 404 }); }
  await fs.mkdir(RESULTS_ROOT, { recursive: true });
  const objectDescription = body.objectDescription ?? "an unwanted object";
  try {
    const prompt = `Remove ${objectDescription} from this photo. Fill the area naturally with the surrounding content — match colors, lighting, textures, and patterns. The result must look like the object was never there. DO NOT change anything else in the image. Keep the exact same framing and full field of view — do not crop or zoom.`;

    // Frame-locked: no backend center-crop, result returned at the source's
    // exact dimensions. edgeLock=false because a removed object may sit at
    // the border (its band legitimately changes).
    const result = await aiEditFrameLocked({ sourcePath: body.sourcePath, prompt, edgeLock: false });
    const buffer = result.buffer;
    const srcW = result.width, srcH = result.height;
    const outName = `rm-obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Object removed: ${objectDescription}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: srcW, height: srcH, size: buffer.length, method: "ai-remove-object", objectRemoved: objectDescription });
  } catch (e) { await logEvent({ category: "tryon", level: "error", message: "Remove object failed", details: e instanceof Error ? e.message : String(e) }); return NextResponse.json({ error: "Remove object failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
