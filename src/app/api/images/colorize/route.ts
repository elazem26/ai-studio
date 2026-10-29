import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.sourcePath) return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  try { body.sourcePath = await resolveFilePath(body.sourcePath); } catch { return NextResponse.json({ error: "Source not found" }, { status: 404 }); }
  await fs.mkdir(RESULTS_ROOT, { recursive: true });
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await ZAIModule.default.create();
    const ext = path.extname(body.sourcePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const b64 = (await fs.readFile(body.sourcePath)).toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const prompt = `Colorize this black-and-white photograph. Add natural, realistic colors to make it look like a real color photo. Use historically-accurate colors. Skin tones natural. Sky blue. Vegetation green. Preserve original details, contrast, composition. DO NOT change composition, add new objects, alter facial features, or over-saturate. RESULT: A colorized version of the same photograph.`;
    const editResponse = await (zai.images.generations.edit as any)({ prompt, images: [{ url: dataUrl }], size: "1024x1024" });
    const imageBase64 = editResponse.data?.[0]?.base64;
    if (!imageBase64) throw new Error("No image returned");
    const buffer = Buffer.from(imageBase64, "base64");
    const outName = `colorized-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    const resultMeta = await sharp(buffer).metadata();
    await logEvent({ category: "tryon", message: `Colorized: ${resultMeta.width}x${resultMeta.height}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: resultMeta.width, height: resultMeta.height, size: buffer.length, method: "ai-colorize" });
  } catch (e) {
    await logEvent({ category: "tryon", level: "error", message: "Colorize failed", details: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: "Colorize failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}
