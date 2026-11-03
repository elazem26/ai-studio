import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createWriteStream } from "fs";
import { execFile } from "child_process";
import path from "path";
import sharp from "sharp";
import { createTask, updateTask } from "@/lib/task-store";
import { prepareForUpload } from "@/lib/video-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 min max

const R = path.resolve(process.cwd(), "data/results");

function runCmd(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, (err, stdout, stderr) => {
      if (err) reject({ err, stdout, stderr });
      else resolve({ stdout, stderr });
    });
  }) as any;
}

/**
 * POST /api/video/preview
 *
 * Query params:
 *   filename:  original filename (e.g. video.3gp, video.avi, video.mkv)
 *   size:      total bytes (for progress)
 *   maxDuration: max preview duration in seconds (default: 10)
 *
 * Body: raw video bytes (streamed to disk)
 *
 * Generates a browser-playable MP4 preview using ffmpeg:
 *   - First 10 seconds of the video (or full if shorter)
 *   - Scaled to 640px wide (preserves aspect ratio)
 *   - H.264 video + AAC audio (universally browser-playable)
 *   - Fast preset for quick generation
 *
 * Returns: { previewUrl: "/results/vpreview-*.mp4", originalSize, duration, hasAudio }
 *
 * Works for ALL formats: .3gp, .avi, .mkv, .flv, .wmv, .ts, .mov, .mp4, .webm, etc.
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(R, { recursive: true });

  const url = new URL(req.url);
  const rawFilename = url.searchParams.get("filename") || "video.mp4";
  const rawSize = parseInt(url.searchParams.get("size") || "0", 10);
  const maxDur = parseInt(url.searchParams.get("maxDuration") || "10", 10);

  const taskId = createTask("Video Preview");
  updateTask(taskId, { status: "processing", progress: 0, label: "Video Preview", phase: "starting" });

  try {
    // ============================================================
    // Disk space pre-check: clean old files first, verify space
    // ============================================================
    const diskCheck = await prepareForUpload(rawSize);
    if (!diskCheck.ok) {
      updateTask(taskId, { status: "error", error: diskCheck.message || "Insufficient disk space" });
      return NextResponse.json({
        error: "INSUFFICIENT_DISK_SPACE",
        message: diskCheck.message,
        freeMB: Math.round((diskCheck.freeBytes >= 0 ? diskCheck.freeBytes : 0) / 1024 / 1024),
        requiredMB: Math.round(diskCheck.requiredBytes / 1024 / 1024),
      }, { status: 507 });
    }

    const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
    const inputName = `vpreview-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
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
    // Phase 2: Generate preview MP4 (progress 50-95%)
    // ============================================================
    updateTask(taskId, { progress: 55, phase: "generating-preview" });
    const outName = `vpreview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const outPath = path.join(R, outName);

    // ffmpeg options:
    // -t maxDur: limit to 10 seconds (or whatever maxDur is)
    // -vf scale=640:-2: scale to 640px wide, preserve aspect ratio (force even dimensions)
    // -c:v libx264 -preset ultrafast -crf 28: fast H.264 encoding, small size
    // -c:a aac -b:a 32k: low-bitrate audio (preview only)
    // -movflags +faststart: streamable MP4 (browser can start playing immediately)
    try {
      await runCmd("ffmpeg", [
        "-y",
        "-i", inputPath,
        "-t", String(maxDur),
        "-vf", "scale=640:trunc(ow/a/2)*2",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
        "-c:a", "aac", "-b:a", "32k",
        "-movflags", "+faststart",
        outPath,
      ]);
    } catch (e: any) {
      // Fallback: try without audio (some videos have no audio stream)
      try {
        await runCmd("ffmpeg", [
          "-y",
          "-i", inputPath,
          "-t", String(maxDur),
          "-vf", "scale=640:trunc(ow/a/2)*2",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
          "-an", // no audio
          "-movflags", "+faststart",
          outPath,
        ]);
      } catch (e2: any) {
        // Last fallback: extract a single frame as PNG poster
        updateTask(taskId, { progress: 80, phase: "generating-poster" });
        const pngName = `vpreview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
        const pngPath = path.join(R, pngName);
        try {
          await runCmd("ffmpeg", [
            "-y",
            "-i", inputPath,
            "-ss", "00:00:01",
            "-vframes", "1",
            "-vf", "scale=640:trunc(ow/a/2)*2",
            pngPath,
          ]);
          try { await fs.unlink(inputPath); } catch {}
          updateTask(taskId, {
            status: "done", progress: 100, phase: "done",
            result: {
              previewUrl: `/results/${pngName}`,
              originalSize: receivedBytes,
              method: "png-poster",
              note: "Could not generate video preview — showing a frame as image",
            },
          });
          return NextResponse.json({ taskId, status: "pending" });
        } catch (e3: any) {
          // Total fallback: Sharp-generated SVG poster
          const svg = `<svg width="640" height="360" xmlns="http://www.w3.org/2000/svg">
            <rect width="640" height="360" fill="#0f3460"/>
            <text x="320" y="180" fill="#e94560" font-size="24" font-family="Arial" text-anchor="middle" font-weight="bold">Preview Unavailable</text>
            <text x="320" y="220" fill="#ccc" font-size="14" font-family="Arial" text-anchor="middle">${safeBase}</text>
          </svg>`;
          const svgBuf = await sharp(Buffer.from(svg)).png().toBuffer();
          const pn = `vpreview-poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
          await fs.writeFile(path.join(R, pn), svgBuf);
          try { await fs.unlink(inputPath); } catch {}
          updateTask(taskId, {
            status: "done", progress: 100, phase: "done",
            result: {
              previewUrl: `/results/${pn}`,
              originalSize: receivedBytes,
              method: "svg-poster",
              note: "Preview generation failed — showing placeholder",
            },
          });
          return NextResponse.json({ taskId, status: "pending" });
        }
      }
    }

    // ============================================================
    // Phase 3: Done (progress 100%)
    // ============================================================
    let previewSize = 0;
    try {
      const stat = await fs.stat(outPath);
      previewSize = stat.size;
    } catch {}

    // Clean up input file (preview MP4 is much smaller)
    try { await fs.unlink(inputPath); } catch {}

    updateTask(taskId, {
      status: "done", progress: 100, phase: "done",
      result: {
        previewUrl: `/results/${outName}`,
        originalSize: receivedBytes,
        previewSize,
        method: "mp4",
        note: `Generated ${maxDur}s MP4 preview via ffmpeg`,
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
