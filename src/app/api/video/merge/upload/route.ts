import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createWriteStream } from "fs";
import path from "path";
import { createTask, updateTask } from "@/lib/task-store";
import { prepareForUpload } from "@/lib/video-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const SESSIONS = path.resolve(process.cwd(), "data/sessions");

/**
 * POST /api/video/merge/upload
 *
 * Streams one video file to a session directory.
 * Query params:
 *   sessionId: unique ID for this merge session (frontend generates once at start)
 *   index:    1-based index of this file in the merge order
 *   filename: original filename
 *   size:     total bytes (for progress)
 *
 * Body: raw video bytes (streamed)
 *
 * Returns: { ok: true, sessionId, index, totalBytes }
 *
 * The frontend calls this endpoint once per file. Each call streams the file
 * to /home/z/my-project/extracted/data/sessions/<sessionId>/input-N-<filename>
 *
 * After all files are uploaded, the frontend calls /api/video/merge/finalize
 * to trigger the actual merge.
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") || `s${Date.now()}`;
  const index = parseInt(url.searchParams.get("index") || "1", 10);
  const rawFilename = url.searchParams.get("filename") || `video-${index}.mp4`;
  const rawSize = parseInt(url.searchParams.get("size") || "0", 10);

  const sessionDir = path.join(SESSIONS, sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  // Create a taskId for tracking this upload (so the UI can poll progress)
  const taskId = `merge-upload-${sessionId}-${index}`;

  // Create a manifest entry
  const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
  const ext = path.extname(rawFilename) || ".mp4";
  const inputName = `input-${String(index).padStart(3, "0")}-${safeBase}`;
  const inputPath = path.join(sessionDir, inputName);

  // Append to the session's file list (so finalize knows the order)
  const listPath = path.join(sessionDir, "files.txt");
  try {
    await fs.appendFile(listPath, `${inputName}\n`, "utf-8");
  } catch {}

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

  // Stream upload
  const totalBytes = rawSize > 0 ? rawSize : 0;
  let receivedBytes = 0;
  const uploadStart = Date.now();

  const writer = createWriteStream(inputPath);
  const reader = req.body!.getReader();

  // Also create a task entry for progress tracking
  updateTask(taskId, {
    status: "processing", progress: 0, label: "Upload File " + index, phase: "uploading",
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise<void>((resolve, reject) => {
        writer.write(Buffer.from(value), (err) => err ? reject(err) : resolve());
      });
      receivedBytes += value.byteLength;
      const uploadProgress = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 50;
      const elapsedSec = (Date.now() - uploadStart) / 1000;
      const speedMBs = elapsedSec > 0 ? (receivedBytes / 1024 / 1024) / elapsedSec : 0;
      const etaSec = totalBytes > 0 && speedMBs > 0 ? (totalBytes - receivedBytes) / 1024 / 1024 / speedMBs : 0;
      updateTask(taskId, {
        status: "processing",
        progress: uploadProgress,
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

  updateTask(taskId, {
    status: "done", progress: 100, phase: "done",
    result: { sessionId, index, totalBytes: receivedBytes, filename: rawFilename },
  });

  return NextResponse.json({ ok: true, sessionId, index, totalBytes: receivedBytes, taskId });
}
