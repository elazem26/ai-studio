import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { resolveFilePath, resolveDataRoot } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROMPTS: Record<string, string> = {
  "3d": "Transform into 3D rendered version.",
  "anime": "Transform into Japanese anime style.",
  "cartoon": "Transform into Western cartoon style.",
  "oil": "Transform into oil painting.",
  "watercolor": "Transform into watercolor painting.",
  "sketch": "Transform into pencil sketch.",
  "pixel": "Transform into pixel art.",
  "digital": "Transform into digital art.",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const img = body.image || body.sourcePath;
  const style = body.style || "anime";

  if (!img) {
    return NextResponse.json({ ok: false, error: "Missing image" }, { status: 400 });
  }
  if (!PROMPTS[style]) {
    return NextResponse.json({ ok: false, error: `Unknown style: ${style}` }, { status: 400 });
  }

  let p: string;
  try {
    p = await resolveFilePath(img);
  } catch {
    return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
  }

  const R = path.resolve(await resolveDataRoot(), "results");
  await fs.mkdir(R, { recursive: true });

  try {
    const ZAI = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.default.create();

    const sb = await fs.readFile(p);
    const m = await sharp(sb).metadata();
    const w = m.width ?? 768;
    const h = m.height ?? 1024;
    const mime = path.extname(p).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${sb.toString("base64")}`;

    // The z-ai API expects `images` (array of { url: dataURL }) for image_to_image tasks.
    // See https://docs.z.ai/apis for the image edit endpoint shape.
    const res = await (zai.images.generations.edit as any)({
      prompt: PROMPTS[style],
      images: [{ url: dataUrl }],
      size: "1024x1024",
    });

    const b64 = res?.data?.[0]?.base64;
    if (!b64) {
      throw new Error("Image edit API returned no image data");
    }

    let buf = Buffer.from(b64, "base64");
    const rm = await sharp(buf).metadata();
    if (rm.width !== w || rm.height !== h) {
      buf = await sharp(buf)
        .resize(w, h, { fit: "fill" })
        .png()
        .toBuffer();
    }

    const finalMeta = await sharp(buf).metadata();
    const out = `style-${style}-${Date.now()}.png`;
    const outPath = path.join(R, out);
    await fs.writeFile(outPath, buf);

    return NextResponse.json({
      ok: true,
      url: `/results/${out}`,
      path: outPath,
      style,
      width: finalMeta.width ?? w,
      height: finalMeta.height ?? h,
      size: buf.length,
      method: "z-ai-image-edit",
    });
  } catch (e: any) {
    console.error("[/api/images/style-transform] error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, styles: Object.keys(PROMPTS) });
}
