import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";

interface UpscaleBody {
  sourcePath: string;
  target: "hd" | "fullHd" | "twoK" | "fourK" | "ultraHd";
}

const RES_MAP: Record<UpscaleBody["target"], number> = {
  hd: 1280,
  fullHd: 1920,
  twoK: 2560,
  fourK: 3840,
  ultraHd: 4096,
};

/**
 * POST /api/images/upscale
 *
 * Uses sharp's Lanczos3 resampling as a stand-in for Real-ESRGAN
 * (which would be the production upscaler on the user's local GPU).
 * This produces a high-quality result that respects the original
 * aspect ratio without inventing hallucinated detail.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as UpscaleBody;
  if (!body.sourcePath) {
    return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  }
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
  } catch {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const targetWidth = RES_MAP[body.target];

  try {
    const buffer = await sharp(body.sourcePath)
      .resize({
        width: targetWidth,
        height: targetWidth,
        fit: "inside",
        withoutEnlargement: false,
        kernel: "lanczos3",
      })
      .sharpen({ sigma: 0.6 })
      .toBuffer();

    const outName = `upscale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outDir = path.resolve(process.cwd(), "data/results");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, outName);
    await fs.writeFile(outPath, buffer);

    const meta = await sharp(buffer).metadata();

    await logEvent({
      category: "tryon",
      message: `Upscaled to ${meta.width}x${meta.height}`,
      details: `target=${body.target}`,
    });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: meta.width,
      height: meta.height,
      size: buffer.length,
    });
  } catch (e) {
    await logEvent({
      category: "tryon",
      level: "error",
      message: "Upscale failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Upscale failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
