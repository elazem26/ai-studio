import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";

interface ExportBody {
  /** Absolute path of source result image */
  sourcePath: string;
  format: "jpg" | "jpeg" | "png" | "webp" | "tiff";
  quality: "low" | "medium" | "high" | "maximum";
  resolution: "original" | "hd" | "fullHd" | "twoK" | "fourK" | "ultraHd";
  dpi?: number;
}

const QUALITY_MAP: Record<ExportBody["quality"], number> = {
  low: 60,
  medium: 75,
  high: 88,
  maximum: 96,
};

const RES_MAP: Record<ExportBody["resolution"], number> = {
  original: 0,    // keep source
  hd: 1280,
  fullHd: 1920,
  twoK: 2560,
  fourK: 3840,
  ultraHd: 4096, // ≈4K UHD
};

/**
 * POST /api/images/export
 * Body: ExportBody
 *
 * Generates an export file in the requested format/quality/resolution
 * and returns a download URL.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ExportBody;
  if (!body.sourcePath) {
    return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  }
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
  } catch {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  try {
    const targetSize = RES_MAP[body.resolution];
    const quality = QUALITY_MAP[body.quality];

    const buffer = await sharp(body.sourcePath, { density: body.dpi ?? 300 })
      .resize(
        targetSize > 0 ? { width: targetSize, height: targetSize, fit: "inside", withoutEnlargement: false } : undefined
      )
      .toFormat(body.format === "jpg" ? "jpeg" : body.format, {
        quality,
      })
      .toBuffer();

    const outName = `export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${body.format}`;
    const outDir = path.resolve(process.cwd(), "data/results");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, outName);
    await fs.writeFile(outPath, buffer);

    await logEvent({
      category: "export",
      message: `Exported ${body.format} ${body.resolution} ${body.quality}`,
      details: `bytes=${buffer.length} dpi=${body.dpi ?? 300}`,
    });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      size: buffer.length,
      format: body.format,
    });
  } catch (e) {
    await logEvent({
      category: "export",
      level: "error",
      message: "Export failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Export failed", message: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
