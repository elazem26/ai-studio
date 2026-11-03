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
export const maxDuration = 3600;

const R = path.resolve(process.cwd(), "data/results");
const SESSIONS = path.resolve(process.cwd(), "data/sessions");

function runCmd(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 50 * 1024 * 1024, timeout: 600000 }, (err, stdout, stderr) => {
      if (err) reject({ err, stdout, stderr });
      else resolve({ stdout, stderr });
    });
  }) as any;
}

async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await runCmd("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * POST /api/video/trim
 *
 * Query params:
 *   filename:   original filename (e.g. video.mp4)
 *   size:       total bytes (for upload progress)
 *   mode:       "remove" (cut out the section, keep rest) | "keep" (extract just the section)
 *   startTime:  start time in seconds (float)
 *   endTime:    end time in seconds (float)
 *
 * Body: raw video bytes (streamed to disk)
 *
 * Phases:
 *   - phase: "uploading"    progress 0-40
 *   - phase: "probing"       progress 40-50
 *   - phase: "extracting"    progress 50-90
 *   - phase: "concatenating" progress 90-95 (only for mode="remove")
 *   - phase: "done"          progress 100
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(R, { recursive: true });

  const taskId = createTask("Video Trim");
  updateTask(taskId, { status: "processing", progress: 0, label: "Video Trim", phase: "starting" });

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
    const mode = (url.searchParams.get("mode") || "remove") as "remove" | "keep";
    const startTime = parseFloat(url.searchParams.get("startTime") || "0");
    const endTime = parseFloat(url.searchParams.get("endTime") || "0");

    const ext = path.extname(rawFilename) || ".mp4";
    const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
    const inputName = `vtrim-input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
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
    // Phase 2: Probe duration (progress 40-50%)
    // ============================================================
    updateTask(taskId, { progress: 45, phase: "probing" });
    const totalDuration = await getVideoDuration(inputPath);
    const safeEnd = endTime > 0 ? endTime : totalDuration;
    const safeStart = Math.max(0, startTime);

    if (totalDuration <= 0) {
      // Can't probe — fall back to copying the whole file
      const n = `vtrim-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      await fs.copyFile(inputPath, path.join(R, n));
      updateTask(taskId, {
        status: "done", progress: 100, phase: "done",
        result: { url: `/results/${n}`, method: "copy", note: "ffprobe failed — kept original" },
      });
      try { await fs.unlink(inputPath); } catch {}
      return NextResponse.json({ taskId, status: "pending" });
    }

    // ============================================================
    // Phase 3: Extract (progress 50-90%)
    // ============================================================
    const baseName = `vtrim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (mode === "keep") {
      // Just extract the section [start, end]
      updateTask(taskId, { progress: 55, phase: "extracting" });
      const outName = `${baseName}-extract${ext}`;
      const outPath = path.join(R, outName);
      try {
        await runCmd("ffmpeg", [
          "-y", "-ss", String(safeStart), "-i", inputPath,
          "-t", String(safeEnd - safeStart),
          "-c", "copy",
          outPath,
        ]);
      } catch {
        // Re-encode fallback
        await runCmd("ffmpeg", [
          "-y", "-ss", String(safeStart), "-i", inputPath,
          "-t", String(safeEnd - safeStart),
          "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
          outPath,
        ]);
      }
      updateTask(taskId, {
        status: "done", progress: 100, phase: "done",
        result: {
          url: `/results/${outName}`,
          method: "extract",
          startTime: safeStart,
          endTime: safeEnd,
          duration: safeEnd - safeStart,
          totalDuration,
        },
      });
    } else {
      // mode === "remove": extract part1 [0, start] + part2 [end, total] then concat
      const segments: { path: string; name: string }[] = [];

      // Part 1: [0, start]
      if (safeStart > 0) {
        updateTask(taskId, { progress: 55, phase: "extracting", currentSegment: 1, totalSegments: 2 });
        const p1Name = `${baseName}-part1${ext}`;
        const p1Path = path.join(R, p1Name);
        try {
          await runCmd("ffmpeg", [
            "-y", "-i", inputPath,
            "-t", String(safeStart),
            "-c", "copy",
            p1Path,
          ]);
          segments.push({ path: p1Path, name: p1Name });
        } catch {
          await runCmd("ffmpeg", [
            "-y", "-i", inputPath,
            "-t", String(safeStart),
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
            p1Path,
          ]);
          segments.push({ path: p1Path, name: p1Name });
        }
      }

      // Part 2: [end, total]
      if (safeEnd < totalDuration) {
        updateTask(taskId, { progress: 75, phase: "extracting", currentSegment: 2, totalSegments: 2 });
        const p2Name = `${baseName}-part2${ext}`;
        const p2Path = path.join(R, p2Name);
        try {
          await runCmd("ffmpeg", [
            "-y", "-ss", String(safeEnd), "-i", inputPath,
            "-c", "copy",
            p2Path,
          ]);
          segments.push({ path: p2Path, name: p2Name });
        } catch {
          await runCmd("ffmpeg", [
            "-y", "-ss", String(safeEnd), "-i", inputPath,
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
            p2Path,
          ]);
          segments.push({ path: p2Path, name: p2Name });
        }
      }

      // ============================================================
      // Phase 4: Concat (progress 90-95%)
      // ============================================================
      updateTask(taskId, { progress: 92, phase: "concatenating" });

      if (segments.length === 0) {
        // Nothing to keep — return a poster
        const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
          <rect width="1280" height="720" fill="#1a1a2e"/>
          <text x="640" y="320" fill="#e94560" font-size="42" font-family="Arial" text-anchor="middle" font-weight="bold">Empty Result</text>
          <text x="640" y="380" fill="#ccc" font-size="22" font-family="Arial" text-anchor="middle">All content removed</text>
        </svg>`;
        const posterBuf = await sharp(Buffer.from(svg)).png().toBuffer();
        const pn = `${baseName}-empty.png`;
        await fs.writeFile(path.join(R, pn), posterBuf);
        updateTask(taskId, {
          status: "done", progress: 100, phase: "done",
          result: { url: `/results/${pn}`, method: "empty", note: "All content removed — empty result" },
        });
      } else if (segments.length === 1) {
        // Only one part — rename it as the result
        const outName = `${baseName}-result${ext}`;
        await fs.rename(segments[0].path, path.join(R, outName));
        updateTask(taskId, {
          status: "done", progress: 100, phase: "done",
          result: {
            url: `/results/${outName}`,
            method: "single-part",
            removedStart: safeStart,
            removedEnd: safeEnd,
            totalDuration,
            note: `Removed ${safeEnd - safeStart}s from middle`,
          },
        });
      } else {
        // Two parts — concat
        const outName = `${baseName}-result${ext}`;
        const outPath = path.join(R, outName);
        const listName = `${baseName}-list.txt`;
        const listPath = path.join(R, listName);
        const listContent = segments.map(s => `file '${s.name}'`).join("\n");
        await fs.writeFile(listPath, listContent);

        try {
          await runCmd("ffmpeg", [
            "-y", "-f", "concat", "-safe", "0",
            "-i", listPath,
            "-c", "copy",
            outPath,
          ]);
        } catch {
          // Re-encode fallback if concat fails
          await runCmd("ffmpeg", [
            "-y", "-f", "concat", "-safe", "0",
            "-i", listPath,
            "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
            outPath,
          ]);
        }

        // Clean up parts + list
        for (const s of segments) { try { await fs.unlink(s.path); } catch {} }
        try { await fs.unlink(listPath); } catch {}

        updateTask(taskId, {
          status: "done", progress: 100, phase: "done",
          result: {
            url: `/results/${outName}`,
            method: "concat-removed",
            removedStart: safeStart,
            removedEnd: safeEnd,
            removedDuration: safeEnd - safeStart,
            totalDuration,
            note: `Removed ${safeEnd - safeStart}s section from middle and concatenated the rest`,
          },
        });
      }
    }

    // Clean up input
    try { await fs.unlink(inputPath); } catch {}
  } catch (e) {
    updateTask(taskId, {
      status: "error",
      error: e instanceof Error ? e.message : "Unknown",
    });
  }

  return NextResponse.json({ taskId, status: "pending" });
}
