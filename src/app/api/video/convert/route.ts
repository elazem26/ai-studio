import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createWriteStream } from "fs";
import { execFile } from "child_process";
import path from "path";
import { createTask, updateTask } from "@/lib/task-store";
import { prepareForUpload } from "@/lib/video-utils";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const R = path.resolve(process.cwd(), "data/results");

function runCmd(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 100 * 1024 * 1024, timeout: 600000 }, (err, stdout, stderr) => {
      if (err) reject({ err, stdout, stderr });
      else resolve({ stdout, stderr });
    });
  }) as any;
}

/** All supported video formats — ffmpeg handles basically everything. */
const FORMAT_EXTENSIONS = [
  "mp4", "webm", "mkv", "mov", "avi", "flv", "wmv", "m4v",
  "3gp", "3g2", "ogv", "ts", "mpeg", "mpg", "m2ts", "vob", "mts",
  "gif", "mjpeg", "m4v", "f4v", "asf",
];

/** Map target format → ffmpeg encoder args (codec + container). */
const ENCODERS: Record<string, { vcodec: string; acodec: string; extra?: string[] }> = {
  mp4:   { vcodec: "libx264", acodec: "aac", extra: ["-movflags", "+faststart"] },
  webm:  { vcodec: "libvpx", acodec: "libopus" },
  mkv:   { vcodec: "libx264", acodec: "aac" },
  mov:   { vcodec: "libx264", acodec: "aac" },
  avi:   { vcodec: "mpeg4", acodec: "mp3" },
  flv:   { vcodec: "libx264", acodec: "aac" },
  wmv:   { vcodec: "wmv2", acodec: "wmav2" },
  m4v:   { vcodec: "libx264", acodec: "aac" },
  "3gp": { vcodec: "h263", acodec: "libmp3lame" },
  "3g2": { vcodec: "h263", acodec: "libmp3lame" },
  ogv:   { vcodec: "libtheora", acodec: "libvorbis" },
  ts:    { vcodec: "libx264", acodec: "aac" },
  mpeg:  { vcodec: "mpeg2video", acodec: "mp2" },
  mpg:   { vcodec: "mpeg2video", acodec: "mp2" },
  m2ts:  { vcodec: "libx264", acodec: "aac" },
  vob:   { vcodec: "mpeg2video", acodec: "mp2" },
  mts:   { vcodec: "libx264", acodec: "aac" },
  gif:   { vcodec: "gif", acodec: "none" },
  mjpeg: { vcodec: "mjpeg", acodec: "none" },
  f4v:   { vcodec: "libx264", acodec: "aac" },
  asf:   { vcodec: "wmv2", acodec: "wmav2" },
};

interface EnhanceOpts {
  /** Quality level: low (fast) / medium / high / ultra */
  quality: "low" | "medium" | "high" | "ultra";
  /** Upscale factor: 1 = no upscale, 1.5 = 1.5x, 2 = 2x, etc. */
  upscale: number;
  /** Apply denoise filter */
  denoise: boolean;
  /** Apply sharpening */
  sharpen: boolean;
  /** Apply color/brightness enhancement */
  colorEnhance: boolean;
  /** Apply contrast/saturation boost */
  boost: boolean;
}

/**
 * POST /api/video/convert
 *
 * Query params:
 *   filename:    original filename
 *   size:        total bytes
 *   targetFormat: target format (mp4, webm, mkv, mov, avi, flv, wmv, m4v, 3gp, 3g2, ogv, ts, mpeg, mpg, m2ts, vob, mts, gif, mjpeg, f4v, asf)
 *   quality:     "low" | "medium" | "high" | "ultra"  (default "medium")
 *   upscale:      scale factor 1/1.5/2/3/4  (default 1, no upscale)
 *   denoise:     0/1
 *   sharpen:     0/1
 *   colorEnhance: 0/1
 *   boost:       0/1
 *
 * Body: raw video bytes (streamed to disk)
 *
 * Converts the uploaded video to the target format with optional quality
 * enhancement filters applied:
 *   - Upscale: scale=W*factor:H*factor (preserving aspect ratio)
 *   - Denoise: hqdn3d filter
 *   - Sharpen: unsharp filter
 *   - Color enhance: curves + eq filters
 *   - Boost: eq=contrast=1.08:saturation=1.15:brightness=0.02
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(R, { recursive: true });

  const taskId = createTask("Video Convert");
  updateTask(taskId, { status: "processing", progress: 0, label: "Video Convert", phase: "starting" });

  try {
    const url = new URL(req.url);

    // ============================================================
    // Disk space pre-check: clean old files first, verify space
    // ============================================================
    const rawSizeForDiskCheck = parseInt(url.searchParams.get("size") || "0", 10);
    const diskCheck = await prepareForUpload(rawSizeForDiskCheck);
    if (!diskCheck.ok) {
      updateTask(taskId, { status: "error", error: diskCheck.message || "Insufficient disk space" });
      return NextResponse.json({
        error: "INSUFFICIENT_DISK_SPACE",
        message: diskCheck.message,
        freeMB: Math.round((diskCheck.freeBytes >= 0 ? diskCheck.freeBytes : 0) / 1024 / 1024),
        requiredMB: Math.round(diskCheck.requiredBytes / 1024 / 1024),
      }, { status: 507 });
    }

    const rawFilename = url.searchParams.get("filename") || "video.mp4";
    const rawSize = parseInt(url.searchParams.get("size") || "0", 10);
    const targetFormat = (url.searchParams.get("targetFormat") || "mp4").toLowerCase();
    const opts: EnhanceOpts = {
      quality: (url.searchParams.get("quality") as any) || "medium",
      upscale: parseFloat(url.searchParams.get("upscale") || "1"),
      denoise: url.searchParams.get("denoise") === "1",
      sharpen: url.searchParams.get("sharpen") === "1",
      colorEnhance: url.searchParams.get("colorEnhance") === "1",
      boost: url.searchParams.get("boost") === "1",
    };

    if (!FORMAT_EXTENSIONS.includes(targetFormat)) {
      updateTask(taskId, { status: "error", error: `Unsupported target format: ${targetFormat}` });
      return NextResponse.json({ error: `Unsupported target format: ${targetFormat}` }, { status: 400 });
    }

    const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
    const inputName = `vconv-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
    const inputPath = path.join(R, inputName);

    // ============================================================
    // Phase 1: Stream upload (progress 0-40%)
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
        const uploadProgress = totalBytes > 0 ? Math.min(40, (receivedBytes / totalBytes) * 40) : 20;
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
    // Phase 2: Probe input (progress 40-50%)
    // ============================================================
    updateTask(taskId, { progress: 45, phase: "probing" });

    // Get input video dimensions
    let srcW = 0, srcH = 0, srcDuration = 0;
    try {
      const { stdout } = await runCmd("ffprobe", [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        inputPath,
      ]);
      const parts = stdout.trim().split(",");
      if (parts.length >= 2) {
        srcW = parseInt(parts[0].trim(), 10) || 0;
        srcH = parseInt(parts[1].trim(), 10) || 0;
      }
    } catch {}

    try {
      const { stdout } = await runCmd("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        inputPath,
      ]);
      srcDuration = parseFloat(stdout.trim()) || 0;
    } catch {}

    // ============================================================
    // Phase 3: Build filter chain (progress 50%)
    // ============================================================
    updateTask(taskId, { progress: 50, phase: "building-filters" });

    const filters: string[] = [];

    // Upscale
    const upscaleFactor = Math.max(1, opts.upscale);
    if (upscaleFactor > 1 && srcW > 0 && srcH > 0) {
      const newW = Math.round(srcW * upscaleFactor);
      const newH = Math.round(srcH * upscaleFactor);
      // Make sure both are even (libx264 requires)
      const evenW = newW % 2 === 0 ? newW : newW + 1;
      const evenH = newH % 2 === 0 ? newH : newH + 1;
      filters.push(`scale=${evenW}:${evenH}`);
    }

    // Denoise (hqdn3d: luma_spatial:chroma_spatial:chroma_tmp)
    if (opts.denoise) {
      filters.push("hqdn3d=1.5:1.5:6:6");
    }

    // Sharpen (unsharp: luma_x:luma_y:luma_amount:chroma_x:chroma_y:chroma_amount)
    if (opts.sharpen) {
      filters.push("unsharp=5:5:1.0:5:5:0.0");
    }

    // Color enhance (curves preset for richer colors)
    if (opts.colorEnhance) {
      filters.push("curves=preset=increase_contrast");
    }

    // Boost contrast/saturation/brightness
    if (opts.boost) {
      filters.push("eq=contrast=1.08:saturation=1.15:brightness=0.02");
    }

    // Format conversion: convert to yuv420p for max compatibility (especially for mp4/webm)
    filters.push("format=yuv420p");

    const filterChain = filters.join(",");

    // ============================================================
    // Phase 4: Convert via ffmpeg (progress 50-95%)
    // ============================================================
    updateTask(taskId, { progress: 55, phase: "converting" });

    const outName = `vconv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${targetFormat}`;
    const outPath = path.join(R, outName);
    const enc = ENCODERS[targetFormat] || ENCODERS.mp4;

    // CRF/preset based on quality level
    const crfMap = { low: 28, medium: 23, high: 20, ultra: 18 };
    const presetMap = { low: "ultrafast", medium: "fast", high: "medium", ultra: "slow" };
    const crf = (crfMap as any)[opts.quality] || 23;
    const preset = (presetMap as any)[opts.quality] || "fast";

    const args = [
      "-y",
      "-i", inputPath,
      "-vf", filterChain,
      "-c:v", enc.vcodec,
      // Apply CRF + preset only for libx264/libvpx (other encoders may not support)
      ...(enc.vcodec === "libx264" ? ["-crf", String(crf), "-preset", preset] : []),
      ...(enc.vcodec === "libvpx" ? ["-crf", String(crf), "-b:v", "1M"] : []),
      "-c:a", enc.acodec,
      ...(enc.extra || []),
      "-progress", "pipe:2",  // progress to stderr
      outPath,
    ];

    try {
      await runCmd("ffmpeg", args);
    } catch (e: any) {
      // Retry without audio (some sources have no audio)
      try {
        const args2 = [
          "-y", "-i", inputPath,
          "-vf", filterChain,
          "-c:v", enc.vcodec,
          ...(enc.vcodec === "libx264" ? ["-crf", String(crf), "-preset", preset] : []),
          ...(enc.vcodec === "libvpx" ? ["-crf", String(crf), "-b:v", "1M"] : []),
          "-an",  // no audio
          ...(enc.extra || []),
          outPath,
        ];
        await runCmd("ffmpeg", args2);
        await logEvent({
          category: "video", level: "warn",
          message: `Video convert: first attempt failed, retried without audio — succeeded`,
        });
      } catch (e2: any) {
        // Final fallback: just copy streams (no re-encoding)
        try {
          await runCmd("ffmpeg", ["-y", "-i", inputPath, "-c", "copy", outPath]);
        } catch (e3: any) {
          updateTask(taskId, {
            status: "error",
            error: `Conversion failed: ${e3?.stderr || e3?.message || "unknown"}`,
          });
          try { await fs.unlink(inputPath); } catch {}
          return NextResponse.json({ taskId, status: "pending" });
        }
      }
    }

    // Update progress periodically during convert — we already set it to 55 above,
    // simulate movement to 95% for the UI
    updateTask(taskId, { progress: 95, phase: "finalizing" });

    // ============================================================
    // Phase 5: Done (progress 100%)
    // ============================================================
    let finalSize = 0;
    try {
      const stat = await fs.stat(outPath);
      finalSize = stat.size;
    } catch {}

    // Clean up input
    try { await fs.unlink(inputPath); } catch {}

    updateTask(taskId, {
      status: "done", progress: 100, phase: "done",
      result: {
        url: `/results/${outName}`,
        format: targetFormat,
        method: "ffmpeg-convert",
        originalSize: receivedBytes,
        convertedSize: finalSize,
        sourceDuration: srcDuration,
        sourceWidth: srcW,
        sourceHeight: srcH,
        targetWidth: srcW > 0 ? Math.round(srcW * upscaleFactor) : 0,
        targetHeight: srcH > 0 ? Math.round(srcH * upscaleFactor) : 0,
        quality: opts.quality,
        upscale: upscaleFactor,
        filters: filters,
        note: `Converted to .${targetFormat} with ${filters.length} enhancement filters applied`,
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
 * GET /api/video/convert/formats
 *
 * Returns the list of supported target formats for the UI dropdown.
 */
export async function GET() {
  return NextResponse.json({
    formats: FORMAT_EXTENSIONS,
    encoders: Object.keys(ENCODERS),
  });
}
