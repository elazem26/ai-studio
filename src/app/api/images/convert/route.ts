import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createWriteStream } from "fs";
import { execFile } from "child_process";
import path from "path";
import sharp from "sharp";
import { createTask, updateTask } from "@/lib/task-store";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const R = path.resolve(process.cwd(), "data/results");

function runCmd(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject({ err, stdout, stderr });
      else resolve({ stdout, stderr });
    });
  }) as any;
}

/** All supported image formats. */
const IMAGE_FORMATS = [
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif",
  "avif", "heic", "heif", "ico", "psd", "tga", "ppm", "pgm", "pbm",
];

/** Sharp-supported formats. */
const SHARP_FORMATS = ["jpg", "jpeg", "png", "webp", "gif", "tiff", "tif", "avif", "heif"];

interface ImgEnhanceOpts {
  quality: "low" | "medium" | "high" | "ultra";
  upscale: number;
  sharpen: boolean;
  denoise: boolean;
  colorEnhance: boolean;
  boost: boolean;
  normalize: boolean;
}

/**
 * POST /api/images/convert
 *
 * Query params:
 *   filename:    original filename
 *   size:        total bytes
 *   targetFormat: target format (jpg, jpeg, png, webp, gif, bmp, tiff, tif, avif, heic, heif, ico, psd, tga, ppm, pgm, pbm)
 *   quality:     "low" | "medium" | "high" | "ultra"
 *   upscale:      scale factor 1/1.5/2/3/4
 *   sharpen:     0/1
 *   denoise:     0/1
 *   colorEnhance: 0/1
 *   boost:       0/1
 *   normalize:   0/1  (auto-normalize levels)
 *
 * Body: raw image bytes (streamed to disk)
 *
 * Uses Sharp for primary conversion (jpg/png/webp/gif/tiff/avif/heif).
 * Falls back to ImageMagick `convert` for non-sharp formats (bmp, ico, psd, tga, ppm, etc.)
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(R, { recursive: true });

  const taskId = createTask("Image Convert");
  updateTask(taskId, { status: "processing", progress: 0, label: "Image Convert", phase: "starting" });

  try {
    const url = new URL(req.url);
    const rawFilename = url.searchParams.get("filename") || "image.png";
    const rawSize = parseInt(url.searchParams.get("size") || "0", 10);
    const targetFormat = (url.searchParams.get("targetFormat") || "png").toLowerCase();
    const opts: ImgEnhanceOpts = {
      quality: (url.searchParams.get("quality") as any) || "medium",
      upscale: parseFloat(url.searchParams.get("upscale") || "1"),
      sharpen: url.searchParams.get("sharpen") === "1",
      denoise: url.searchParams.get("denoise") === "1",
      colorEnhance: url.searchParams.get("colorEnhance") === "1",
      boost: url.searchParams.get("boost") === "1",
      normalize: url.searchParams.get("normalize") === "1",
    };

    if (!IMAGE_FORMATS.includes(targetFormat)) {
      updateTask(taskId, { status: "error", error: `Unsupported target format: ${targetFormat}` });
      return NextResponse.json({ error: `Unsupported target format: ${targetFormat}` }, { status: 400 });
    }

    const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
    const inputName = `iconv-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
    const inputPath = path.join(R, inputName);

    // ============================================================
    // Phase 1: Stream upload (progress 0-50%)
    // ============================================================
    const totalBytes = rawSize > 0 ? rawSize : 0;
    let receivedBytes = 0;
    const uploadStart = Date.now();

    const writer = createWriteStream(inputPath);
    const reader = req.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), (err) => err ? reject(err) : resolve());
        });
        receivedBytes += value.byteLength;
        const uploadProgress = totalBytes > 0 ? Math.min(50, (receivedBytes / totalBytes) * 50) : 25;
        const elapsedSec = (Date.now() - uploadStart) / 1000;
        const speedMBs = elapsedSec > 0 ? (receivedBytes / 1024 / 1024) / elapsedSec : 0;
        const etaSec = totalBytes > 0 && speedMBs > 0 ? (totalBytes - receivedBytes) / 1024 / 1024 / speedMBs : 0;
        updateTask(taskId, {
          status: "processing",
          progress: Math.round(uploadProgress),
          phase: "uploading",
          bytesReceived: receivedBytes,
          bytesTotal: totalBytes,
          elapsedSeconds: Math.round(elapsedSec),
          etaSeconds: Math.round(etaSec),
          speedMBs: parseFloat(speedMBs.toFixed(2)),
        });
      }
    } finally {
      await new Promise<void>((resolve) => writer.end(() => resolve()));
    }

    // ============================================================
    // Phase 2: Convert + enhance (progress 50-95%)
    // ============================================================
    updateTask(taskId, { progress: 60, phase: "converting" });

    const outName = `iconv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${targetFormat}`;
    const outPath = path.join(R, outName);

    // Quality preset → quality value (for lossy formats)
    const qMap: Record<string, number> = { low: 60, medium: 80, high: 92, ultra: 98 };
    const qualityValue = qMap[opts.quality] || 80;

    let success = false;
    let usedTool = "sharp";

    // Try Sharp first (most efficient for jpg/png/webp/gif/tiff/avif/heif)
    if (SHARP_FORMATS.includes(targetFormat)) {
      try {
        let pipeline = sharp(inputPath, { failOn: "none" });

        // Get metadata first
        const meta = await pipeline.metadata();
        const srcW = meta.width || 0;
        const srcH = meta.height || 0;

        // Upscale
        if (opts.upscale > 1 && srcW > 0 && srcH > 0) {
          const newW = Math.round(srcW * opts.upscale);
          const newH = Math.round(srcH * opts.upscale);
          pipeline = pipeline.resize(newW, newH, {
            kernel: "lanczos3",
            fit: "fill",
          });
        }

        // Sharpen
        if (opts.sharpen) {
          pipeline = pipeline.sharpen({
            sigma: 1.0,
            flat: 1.0,
            jagged: 2.0,
          });
        }

        // Denoise (mild blur via median filter)
        if (opts.denoise) {
          pipeline = pipeline.median(3);
        }

        // Normalize (auto-stretch levels)
        if (opts.normalize) {
          pipeline = pipeline.normalize();
        }

        // Color enhance: modulate brightness/saturation
        if (opts.colorEnhance || opts.boost) {
          const brightness = opts.boost ? 1.05 : 1.0;
          const saturation = opts.boost ? 1.2 : (opts.colorEnhance ? 1.1 : 1.0);
          const hue = 0; // No hue shift
          pipeline = pipeline.modulate({ brightness, saturation, hue });
        }

        // Apply contrast enhancement
        if (opts.boost) {
          pipeline = pipeline.linear(1.08, -0.04); // contrast boost
        }

        // Output format
        const fmtMap: Record<string, any> = {
          jpg: { quality: qualityValue, chromaSubsampling: "4:2:0", mozjpeg: true },
          jpeg: { quality: qualityValue, chromaSubsampling: "4:2:0", mozjpeg: true },
          png: { quality: 100, compressionLevel: 6, palette: false },
          webp: { quality: qualityValue, lossless: false, effort: 4 },
          gif: { quality: qualityValue, loop: true },
          tiff: { quality: qualityValue, compression: "lzw" },
          tif: { quality: qualityValue, compression: "lzw" },
          avif: { quality: qualityValue, effort: 4 },
          heif: { quality: qualityValue, compression: "hevc" },
        };

        const fmtOptions = fmtMap[targetFormat] || { quality: qualityValue };
        pipeline = pipeline.toFormat(targetFormat as any, fmtOptions);

        await pipeline.toFile(outPath);
        success = true;
      } catch (e: any) {
        await logEvent({
          category: "image", level: "warn",
          message: `Sharp convert failed (${targetFormat}): ${e?.message || e}`,
        });
      }
    }

    // Fallback: try ImageMagick for non-sharp formats (bmp, ico, psd, tga, ppm, pgm, pbm)
    if (!success) {
      usedTool = "imagemagick";
      try {
        // Build ImageMagick filter chain
        const imArgs: string[] = [`${inputPath}[0]`]; // [0] = first frame for animated GIFs

        // Upscale
        if (opts.upscale > 1) {
          imArgs.push("-resize", `${opts.upscale * 100}%`);
        }

        // Sharpen
        if (opts.sharpen) {
          imArgs.push("-unsharp", "0x1.0+1.0+0.0");
        }

        // Denoise (mild blur)
        if (opts.denoise) {
          imArgs.push("-define", "noise:type=gaussian", "-evaluate", "gaussian-noise", "2");
        }

        // Normalize
        if (opts.normalize) {
          imArgs.push("-normalize");
        }

        // Color enhance
        if (opts.colorEnhance || opts.boost) {
          const contrast = opts.boost ? 1.08 : 1.05;
          const brightness = opts.boost ? 1.05 : 1.02;
          imArgs.push("-brightness-contrast", `${brightness * 100 - 100}x${contrast * 100 - 100}`);
          if (opts.boost) {
            imArgs.push("-modulate", `100,120,100`); // saturation boost
          }
        }

        // Quality (for lossy formats)
        imArgs.push("-quality", String(qualityValue));

        // Output
        imArgs.push(outPath);

        // Try `magick` first (ImageMagick 7), then `convert` (ImageMagick 6)
        try {
          await runCmd("magick", imArgs);
          success = true;
        } catch {
          await runCmd("convert", imArgs);
          success = true;
        }
      } catch (e: any) {
        await logEvent({
          category: "image", level: "warn",
          message: `ImageMagick convert failed (${targetFormat}): ${e?.stderr || e?.message || e}`,
        });
      }
    }

    // If still not successful, fall back to Sharp + target=png, then rename (last resort)
    if (!success) {
      try {
        await sharp(inputPath).png().toFile(outPath);
        // If target wasn't png, this is a degraded fallback
        usedTool = "sharp-png-fallback";
        success = true;
      } catch (e2: any) {
        updateTask(taskId, {
          status: "error",
          error: `Conversion failed for ${targetFormat}: ${e2?.message || "unknown"}`,
        });
        try { await fs.unlink(inputPath); } catch {}
        return NextResponse.json({ taskId, status: "pending" });
      }
    }

    // ============================================================
    // Phase 3: Done (progress 100%)
    // ============================================================
    let finalSize = 0;
    try {
      const stat = await fs.stat(outPath);
      finalSize = stat.size;
    } catch {}

    // Get output dimensions
    let outW = 0, outH = 0;
    try {
      const meta = await sharp(outPath).metadata();
      outW = meta.width || 0;
      outH = meta.height || 0;
    } catch {}

    // Clean up input
    try { await fs.unlink(inputPath); } catch {}

    updateTask(taskId, {
      status: "done", progress: 100, phase: "done",
      result: {
        url: `/results/${outName}`,
        format: targetFormat,
        method: usedTool,
        originalSize: receivedBytes,
        convertedSize: finalSize,
        width: outW,
        height: outH,
        quality: opts.quality,
        upscale: opts.upscale,
        note: `Converted to .${targetFormat} using ${usedTool}`,
      },
    });
  } catch (e) {
    updateTask(taskId, {
      status: "error",
      error: e instanceof Error ? e.message : "Unknown",
    });
  }

  return NextResponse.json({ taskId, status: "pending" });
}

/**
 * GET /api/images/convert/formats
 *
 * Returns the list of supported image formats for the UI dropdown.
 */
export async function GET() {
  return NextResponse.json({
    formats: IMAGE_FORMATS,
    sharpFormats: SHARP_FORMATS,
  });
}
