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
  try {
    const prompt = `Colorize this black-and-white photograph. Add natural, realistic colors to make it look like a real color photo. Use historically-accurate colors. Skin tones natural. Sky blue. Vegetation green. Preserve original details, contrast, composition EXACTLY — keep the full field of view, do not crop or zoom. DO NOT change composition, add new objects, alter facial features, or over-saturate. RESULT: A colorized version of the same photograph.`;
    // Frame-locked: keeps the source's exact dimensions and field of view
    // (the old fixed 1024x1024 canvas made the backend crop a 4:3 photo).
    const result = await aiEditFrameLocked({ sourcePath: body.sourcePath, prompt, edgeLock: false });
    const buffer = result.buffer;
    const outName = `colorized-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Colorized: ${result.width}x${result.height}, canvas=${result.canvas}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: result.width, height: result.height, size: buffer.length, method: "ai-colorize", canvas: result.canvas });
  } catch (e) {
    await logEvent({ category: "tryon", level: "error", message: "Colorize failed", details: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Colorize failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
