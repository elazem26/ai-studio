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
  const bgColor = body.backgroundColor ?? "#ffffff";
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await ZAIModule.default.create();
    const ext = path.extname(body.sourcePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const b64 = (await fs.readFile(body.sourcePath)).toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const prompt = `Remove the background from this photo. Keep ONLY the main subject (person, object, or product). Replace the background with a solid ${bgColor} color. 

CRITICAL: 1. Identify the main subject 2. Remove ALL background 3. Place subject on solid ${bgColor} 4. Keep subject's edges clean — no halo, no leftover background 5. Preserve subject exactly — face, body, clothing, shadows from subject`;

    const editResponse = await (zai.images.generations.edit as any)({ prompt, images: [{ url: dataUrl }], size: "1024x1024" });
    const imageBase64 = editResponse.data?.[0]?.base64;
    if (!imageBase64) throw new Error("AI returned no image");
    let buffer = Buffer.from(imageBase64, "base64");
    const sourceMeta = await sharp(body.sourcePath).metadata();
    const srcW = sourceMeta.width ?? 1024, srcH = sourceMeta.height ?? 1024;
    const resultMeta = await sharp(buffer).metadata();
    if (resultMeta.width !== srcW || resultMeta.height !== srcH) {
      buffer = await sharp(buffer).resize(srcW, srcH, { kernel: "lanczos3", fit: "fill" }).png({ quality: 92 }).toBuffer();
    }
    const outName = `no-bg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Background removed (AI)` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: srcW, height: srcH, size: buffer.length, method: "ai-remove-bg", backgroundColor: bgColor });
  } catch (e) { await logEvent({ category: "tryon", level: "error", message: "Remove BG failed", details: e instanceof Error ? e.message : String(e) }); return NextResponse.json({ error: "Remove BG failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
