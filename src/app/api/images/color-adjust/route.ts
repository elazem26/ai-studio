import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { resolveFilePath } from "@/lib/security/resolve-file-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");

interface ColorAdjustBody {
  sourcePath: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  temperature?: number;
  tint?: number;
  vibrance?: number;
  exposure?: number;
  gamma?: number;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as ColorAdjustBody;
  if (!body.sourcePath) {
    return NextResponse.json({ error: "Missing sourcePath" }, { status: 400 });
  }
  try {
    body.sourcePath = await resolveFilePath(body.sourcePath);
  } catch {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await fs.mkdir(RESULTS_ROOT, { recursive: true });

  const brightness = clamp(body.brightness ?? 0, -100, 100);
  const contrast = clamp(body.contrast ?? 0, -100, 100);
  const saturation = clamp(body.saturation ?? 0, -100, 100);
  const hue = clamp(body.hue ?? 0, -180, 180);
  const temperature = clamp(body.temperature ?? 0, -100, 100);
  const tint = clamp(body.tint ?? 0, -100, 100);
  const vibrance = clamp(body.vibrance ?? 0, -100, 100);
  const exposure = clamp(body.exposure ?? 0, -100, 100);
  const gamma = clampGamma(body.gamma ?? 1.0);

  try {
    let pipeline: sharp.Sharp = sharp(body.sourcePath);

    if (gamma !== 1.0) pipeline = pipeline.gamma(gamma);
    if (Math.abs(exposure) > 0.5) {
      pipeline = pipeline.modulate({ brightness: 1 + (exposure / 200) });
    }
    if (Math.abs(brightness) > 0.5) {
      pipeline = pipeline.modulate({ brightness: 1 + (brightness / 200) });
    }
    if (Math.abs(contrast) > 0.5) {
      const slope = 1 + (contrast / 200);
      const b = (1 - slope) / 2;
      pipeline = pipeline.linear(slope, b);
    }
    if (Math.abs(saturation) > 0.5) {
      pipeline = pipeline.modulate({ saturation: 1 + (saturation / 100) });
    }
    if (Math.abs(hue) > 0.5) {
      const rad = (hue * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      pipeline = pipeline.recomb([
        [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
        [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283],
        [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
      ]);
    }
    if (Math.abs(vibrance) > 0.5) {
      pipeline = pipeline.modulate({ saturation: 1 + (vibrance / 200) });
    }
    if (Math.abs(temperature) > 0.5) {
      const t = temperature / 100;
      pipeline = pipeline.linear([1, 1, 1], [t * 30, 0, -t * 30]);
    }
    if (Math.abs(tint) > 0.5) {
      const t = tint / 100;
      pipeline = pipeline.linear([1, 1, 1], [t * 20, -t * 25, t * 20]);
    }

    const buffer = await pipeline.png({ quality: 92 }).toBuffer();
    const outName = `color-adjust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const outPath = path.join(RESULTS_ROOT, outName);
    await fs.writeFile(outPath, buffer);
    const meta = await sharp(buffer).metadata();

    await logEvent({ category: "tryon", message: `Color adjust: b=${brightness} c=${contrast} s=${saturation}` });

    return NextResponse.json({
      url: `/results/${outName}`,
      path: outPath,
      width: meta.width,
      height: meta.height,
      size: buffer.length,
      method: "sharp-color-adjust",
    });
  } catch (e) {
    return NextResponse.json({ error: "Color adjust failed", message: e instanceof Error ? e.message : "unknown" }, { status: 500 });
  }
}

function clamp(v: number, min: number, max: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(min, Math.min(max, v));
}
function clampGamma(v: number): number {
  if (Number.isNaN(v)) return 1.0;
  return Math.max(0.1, Math.min(3.0, v));
}
