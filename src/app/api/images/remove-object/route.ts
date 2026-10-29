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
  const objectDescription = body.objectDescription ?? "an unwanted object";
  try {
    const ZAIModule = await import("z-ai-web-dev-sdk");
    const zai = await ZAIModule.default.create();
    const ext = path.extname(body.sourcePath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    const b64 = (await fs.readFile(body.sourcePath)).toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;
    const prompt = `Remove ${objectDescription} from this photo. Fill the area naturally with the surrounding content — match colors, lighting, textures, and patterns. The result must look like the object was never there. DO NOT change anything else in the image.`;

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
    const outName = `rm-obj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    await logEvent({ category: "tryon", message: `Object removed: ${objectDescription}` });
    return NextResponse.json({ url: `/results/${outName}`, path: outPath, width: srcW, height: srcH, size: buffer.length, method: "ai-remove-object", objectRemoved: objectDescription });
  } catch (e) { await logEvent({ category: "tryon", level: "error", message: "Remove object failed", details: e instanceof Error ? e.message : String(e) }); return NextResponse.json({ error: "Remove object failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 }); }
}
