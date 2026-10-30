import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { resolveFilePath, resolveDataRoot } from "@/lib/security/resolve-file-path";
import { aiEditFrameLocked } from "@/lib/ai-image-edit";

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
    // Frame-locked AI edit: keeps the full field of view and the source's
    // exact dimensions (no backend center-crop from the old 1024x1024 canvas).
    // edgeLock=false — a style transform legitimately changes every band.
    // BACKGROUND LOCK: the user wants the SAME background/setting — the
    // style applies to the rendering, not to a different scene.
    const result = await aiEditFrameLocked({
      sourcePath: p,
      prompt: `${PROMPTS[style]}\n\nBACKGROUND LOCK — CRITICAL:
- Keep the EXACT same background, scene, setting, objects and composition as the original photo — do NOT replace the background with a different scene or location.
- The style is applied to the RENDERING of the same scene (same layout, same camera framing, same pose), not to a new setting.
- Keep the same framing and the FULL field of view — do not crop, zoom, or shift the frame.`,
      edgeLock: false,
    });

    const buf = result.buffer;

    const finalMeta = await sharp(buf).metadata();
    const out = `style-${style}-${Date.now()}.png`;
    const outPath = path.join(R, out);
    await fs.writeFile(outPath, buf);

    return NextResponse.json({
      ok: true,
      url: `/results/${out}`,
      path: outPath,
      style,
      width: result.width,
      height: result.height,
      size: buf.length,
      method: "z-ai-image-edit-frame-locked",
      canvas: result.canvas,
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
