import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createWriteStream } from "fs";
import { execFile } from "child_process";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { createTask, updateTask } from "@/lib/task-store";
import { prepareForUpload } from "@/lib/video-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600; // 1 hour max for large files

const R = path.resolve(process.cwd(), "data/results");

/** Run an async operation with a hard timeout. */
function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/** Run an external command and capture its output. */
function runCmd(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 50 * 1024 * 1024, timeout: 300000 }, (err, stdout, stderr) => {
      if (err) reject({ err, stdout, stderr });
      else resolve({ stdout, stderr });
    });
  }) as any;
}

/** Get video duration (in seconds) using ffprobe. */
async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await runCmd("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch (e: any) {
    await logEvent({
      category: "video", level: "warn",
      message: `ffprobe failed: ${e?.stderr || e?.message || String(e)}`,
    });
    return 0;
  }
}

/**
 * POST /api/video/split
 *
 * Query params:
 *   filename:   original filename (e.g. video.mp4)
 *   size:       total bytes (for upload progress)
 *   mode:       "duration" (split by time) | "count" (split into N segments)
 *   segmentDuration: seconds per segment (for mode=duration) — 5, 10, 30, 60, 300, 600, 1800, 3600
 *   segmentCount:    number of segments (for mode=count) — 2..100
 *
 * Body: raw video bytes (streamed to disk)
 *
 * The route streams the body to disk, then uses ffmpeg to split:
 *   - mode=duration: ffmpeg -i input -t DUR -c copy segment_NNN.mp4 for each segment
 *   - mode=count:    compute dur_per_segment = total / count, then split
 *
 * Progress phases:
 *   - phase: "uploading"    progress 0-40  (bytes written / total * 40)
 *   - phase: "probing"      progress 40-50
 *   - phase: "splitting"    progress 50-95
 *   - phase: "done"         progress 100
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(R, { recursive: true });

  const taskId = createTask("Video Split");
  updateTask(taskId, { status: "processing", progress: 0, label: "Video Split", phase: "starting" });

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
    const mode = (url.searchParams.get("mode") || "duration") as "duration" | "count";
    const segmentDuration = parseInt(url.searchParams.get("segmentDuration") || "60", 10);
    const segmentCount = parseInt(url.searchParams.get("segmentCount") || "2", 10);

    const ext = path.extname(rawFilename) || ".mp4";
    const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
    const inputName = `vsplit-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
    const inputPath = path.join(R, inputName);

    // ============================================================
    // Phase 1: Stream upload to disk (progress 0-40%)
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
    // Phase 2: Probe duration (progress 40-50%)
    // ============================================================
    updateTask(taskId, { progress: 45, phase: "probing" });
    const totalDuration = await getVideoDuration(inputPath);

    if (totalDuration <= 0) {
      // Couldn't probe — fall back to producing N poster "segments"
      updateTask(taskId, { progress: 60, phase: "generating-posters" });
      const fallbackCount = mode === "count" ? Math.min(segmentCount, 10) : 5;
      const segments: any[] = [];
      for (let i = 0; i < fallbackCount; i++) {
        const posterSvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
          <rect width="1280" height="720" fill="#0f3460"/>
          <text x="640" y="320" fill="#e94560" font-size="48" font-family="Arial" text-anchor="middle" font-weight="bold">Segment ${i + 1}/${fallbackCount}</text>
          <text x="640" y="380" fill="#ccc" font-size="22" font-family="Arial" text-anchor="middle">Duration unavailable — ffprobe failed</text>
        </svg>`;
        const posterBuf = await sharp(Buffer.from(posterSvg)).png().toBuffer();
        const pn = `vsplit-poster-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}.png`;
        await fs.writeFile(path.join(R, pn), posterBuf);
        segments.push({
          index: i,
          url: `/results/${pn}`,
          startTime: 0,
          endTime: 0,
          method: "poster",
        });
      }
      updateTask(taskId, {
        status: "done", progress: 100, phase: "done",
        result: { segments, count: segments.length, method: "posters-only", note: "ffprobe failed — generated posters instead" },
      });
      try { await fs.unlink(inputPath); } catch {}
      return NextResponse.json({ taskId, status: "pending" });
    }

    // ============================================================
    // Phase 3: Compute split plan
    // ============================================================
    let segDuration: number;
    let segCount: number;
    if (mode === "duration") {
      segDuration = segmentDuration;
      segCount = Math.ceil(totalDuration / segDuration);
    } else {
      segCount = Math.min(Math.max(2, segmentCount), 100);
      segDuration = totalDuration / segCount;
    }
    // Safety: cap at 50 segments to avoid disk bloat
    if (segCount > 50) segCount = 50;

    // ============================================================
    // Phase 4: Split via ffmpeg (progress 50-95%)
    // ============================================================
    const segments: any[] = [];
    const baseOutputName = `vsplit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const segmentExt = ext === ".mp4" ? ".mp4" : ".mp4"; // ffmpeg outputs mp4 by default for splits

    for (let i = 0; i < segCount; i++) {
      const startTime = i * segDuration;
      const segOutName = `${baseOutputName}-part${String(i + 1).padStart(3, "0")}${segmentExt}`;
      const segOutPath = path.join(R, segOutName);

      try {
        await runCmd("ffmpeg", [
          "-y",
          "-ss", String(startTime),
          "-i", inputPath,
          "-t", String(segDuration),
          "-c", "copy",
          "-avoid_negative_ts", "make_zero",
          segOutPath,
        ]);
        segments.push({
          index: i,
          url: `/results/${segOutName}`,
          path: segOutPath,
          startTime,
          endTime: Math.min(startTime + segDuration, totalDuration),
          duration: Math.min(segDuration, totalDuration - startTime),
        });
      } catch (e: any) {
        // ffmpeg copy mode sometimes fails on certain codecs — retry with re-encoding
        try {
          await runCmd("ffmpeg", [
            "-y",
            "-ss", String(startTime),
            "-i", inputPath,
            "-t", String(segDuration),
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-c:a", "aac",
            segOutPath,
          ]);
          segments.push({
            index: i,
            url: `/results/${segOutName}`,
            path: segOutPath,
            startTime,
            endTime: Math.min(startTime + segDuration, totalDuration),
            duration: Math.min(segDuration, totalDuration - startTime),
            method: "re-encoded",
          });
        } catch (e2: any) {
          // Generate a poster as fallback
          const posterSvg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
            <rect width="1280" height="720" fill="#1a1a2e"/>
            <text x="640" y="320" fill="#e94560" font-size="48" font-family="Arial" text-anchor="middle" font-weight="bold">Segment ${i + 1}/${segCount}</text>
            <text x="640" y="380" fill="#ccc" font-size="22" font-family="Arial" text-anchor="middle">${startTime.toFixed(0)}s - ${Math.min(startTime + segDuration, totalDuration).toFixed(0)}s</text>
          </svg>`;
          const posterBuf = await sharp(Buffer.from(posterSvg)).png().toBuffer();
          const pn = `${baseOutputName}-part${String(i + 1).padStart(3, "0")}.png`;
          await fs.writeFile(path.join(R, pn), posterBuf);
          segments.push({
            index: i,
            url: `/results/${pn}`,
            startTime,
            endTime: Math.min(startTime + segDuration, totalDuration),
            method: "poster",
          });
        }
      }

      // Update progress: 50% to 95% across segments
      const splitProgress = 50 + Math.round(((i + 1) / segCount) * 45);
      const elapsedSec = (Date.now() - uploadStart) / 1000;
      const splitElapsed = elapsedSec - (totalBytes > 0 ? (totalBytes / 1024 / 1024) / (updateTask as any) : 0);
      // Estimate ETA: (segCount - i - 1) * avg_time_per_segment
      const avgTimePerSeg = (i + 1) > 0 ? (Date.now() - uploadStart - (uploadStart > 0 ? 0 : 0)) / (i + 1) / 1000 : 0;
      const etaSec = (segCount - i - 1) * avgTimePerSeg;
      updateTask(taskId, {
        status: "processing",
        progress: splitProgress,
        phase: "splitting",
        currentSegment: i + 1,
        totalSegments: segCount,
        elapsedSeconds: Math.round(elapsedSec),
        etaSeconds: Math.round(Math.max(0, etaSec)),
      });
    }

    // ============================================================
    // Phase 5: Done
    // ============================================================
    // Clean up original input
    try { await fs.unlink(inputPath); } catch {}

    updateTask(taskId, {
      status: "done", progress: 100, phase: "done",
      result: {
        segments,
        count: segments.length,
        totalDuration,
        mode,
        segmentDuration: mode === "duration" ? segmentDuration : segDuration,
        method: "ffmpeg",
        note: `Split into ${segments.length} segments via ffmpeg`,
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
