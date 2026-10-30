import { NextRequest, NextResponse } from "next/server";
import { promises as fs, createWriteStream } from "fs";
import { execFile } from "child_process";
import path from "path";
import { createTask, updateTask } from "@/lib/task-store";
import { resolveFilePath } from "@/lib/security/resolve-file-path";
import { tryAcquireProcessingLock, releaseProcessingLock, getProcessingStatus } from "@/lib/processing-lock";
import { sweepOldVideos } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

const R = path.resolve(process.cwd(), "data/results");
const MINI_SERVICE_URL = process.env.FACE_SWAP_SERVICE_URL || "http://localhost:3030";

/** Extract a representative frame as a JPG poster (t=1s, fallback t=0). */
async function extractPoster(videoPath: string): Promise<string> {
  const name = `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const out = path.join(R, name);
  const tryAt = async (ss: string) =>
    new Promise<boolean>((resolve) => {
      execFile("ffmpeg", ["-y", "-ss", ss, "-i", videoPath, "-frames:v", "1", "-vf", "scale=1280:-2", out],
        { timeout: 60_000 }, (err) => resolve(!err));
    });
  let ok = await tryAt("1");
  if (!ok) ok = await tryAt("0");
  return ok ? `/results/${name}` : "";
}

async function isMiniServiceUp(): Promise<boolean> {
  try {
    const r = await fetch(`${MINI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function spawnServiceIfDown(): Promise<boolean> {
  if (await isMiniServiceUp()) return true;
  try {
    const { spawn } = (typeof eval !== "undefined") ? eval("require")("child_process") : require("child_process");
    const proc = spawn("/home/z/.venv/bin/python3", [`${process.cwd()}/mini-services/face-swap-pro/server.py`], {
      cwd: process.cwd(), detached: true, stdio: "ignore", env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    proc.unref();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isMiniServiceUp()) return true;
    }
    return false;
  } catch { return false; }
}

/** Detect faces + persons on a still image via the python service.
 *  Both endpoints run IN PARALLEL (saves ~1s per upload). */
async function detectBoth(dataUrl: string): Promise<{ faces: any[]; persons: any[] }> {
  const call = async (endpoint: "detect" | "detect-persons"): Promise<any[]> => {
    try {
      const res = await fetch(`${MINI_SERVICE_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
        signal: AbortSignal.timeout(60_000),
      });
      const d: any = await res.json().catch(() => ({}));
      if (res.ok && d?.ok) return (endpoint === "detect" ? d.faces : d.persons) ?? [];
    } catch { /* keep empty */ }
    return [];
  };
  const [faces, persons] = await Promise.all([call("detect"), call("detect-persons")]);
  return { faces, persons };
}

/**
 * POST /api/video/face-swap?mode=upload&filename=x.mp4&size=N
 *   Raw-byte video upload → save → extract poster frame → detect faces
 *   AND persons (for the numbered boxes UI). Task result:
 *   { videoPath, posterUrl, faces, persons }
 *
 * POST /api/video/face-swap  (JSON)
 *   { videoPath, refPath, mappings: [{ videoIndex, refIndex }], mode: "face"|"garment", maxFrames? }
 *   Starts the python video job and polls it. Task result: { url, posterUrl, ... }
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const uploadMode = url.searchParams.get("mode") === "upload" || req.headers.get("content-type")?.includes("octet-stream");

  if (uploadMode) {
    return handleUpload(req, url);
  }
  return handleStart(req);
}

/* ============================== UPLOAD ============================== */

async function handleUpload(req: NextRequest, url: URL) {
  await fs.mkdir(R, { recursive: true });
  // Free space early: delete video files older than 30 min
  // (sources + intermediates + old results — per retention policy).
  void sweepOldVideos(30).catch(() => {});
  const taskId = createTask("Video Upload+Detect");
  updateTask(taskId, { status: "processing", progress: 0, label: "Video Upload+Detect", phase: "uploading" });

  try {
    const rawFilename = url.searchParams.get("filename") || "video.mp4";
    const rawSize = parseInt(url.searchParams.get("size") || "0", 10) || 0;
    const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
    const name = `vswap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
    const outPath = path.join(R, name);

    let received = 0;
    const writer = createWriteStream(outPath);
    const reader = req.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await new Promise<void>((resolve, reject) =>
          writer.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()))
        );
        received += value.byteLength;
        const pct = rawSize > 0 ? Math.min(70, (received / rawSize) * 70) : 30;
        updateTask(taskId, { status: "processing", progress: Math.round(pct), phase: "uploading", bytesReceived: received, bytesTotal: rawSize });
      }
    } finally {
      await new Promise<void>((resolve) => writer.end(() => resolve()));
    }

    // Extract poster frame
    updateTask(taskId, { status: "processing", progress: 75, phase: "frame-extract" });
    const posterUrl = await extractPoster(outPath);
    if (!posterUrl) {
      await fs.unlink(outPath).catch(() => {});
      updateTask(taskId, { status: "error", error: "تعذر استخراج إطار من الفيديو — قد يكون الملف تالفاً أو بصيغة غير مدعومة" });
      return NextResponse.json({ taskId, error: "FRAME_EXTRACT_FAILED" }, { status: 500 });
    }

    // Detect faces + persons on the poster frame
    updateTask(taskId, { status: "processing", progress: 85, phase: "detecting" });
    if (!(await spawnServiceIfDown())) {
      updateTask(taskId, { status: "error", error: "خدمة الرصد غير متاحة" });
      return NextResponse.json({ taskId, error: "SERVICE_DOWN" }, { status: 503 });
    }
    const posterAbs = path.join(R, posterUrl.replace("/results/", ""));
    const posterBuf = await fs.readFile(posterAbs);
    const dataUrl = `data:image/jpeg;base64,${posterBuf.toString("base64")}`;
    const { faces, persons } = await detectBoth(dataUrl);

    updateTask(taskId, {
      status: "done", progress: 100, phase: "done",
      result: { videoPath: `/results/${name}`, posterUrl, faces, persons, size: received },
    });
    return NextResponse.json({ taskId });
  } catch (e) {
    updateTask(taskId, { status: "error", error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ taskId, error: "UPLOAD_FAILED" }, { status: 500 });
  }
}

/* ============================== START ============================== */

async function handleStart(req: NextRequest) {
  if (!tryAcquireProcessingLock("video-swap")) {
    const st = getProcessingStatus();
    return NextResponse.json({
      error: `عملية "${st.op}" جارية الآن (${Math.round(st.elapsedMs / 1000)}s). انتظر انتهاءها ثم أعد المحاولة.`,
      retryAfter: 5, busyWith: st.op,
    }, { status: 429 });
  }
  try {
    return await _start_impl(req);
  } finally {
    releaseProcessingLock();
  }
}

async function _start_impl(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const videoUrlPath: string = body.videoPath;
  const refPath: string = body.refPath;
  const mode: string = body.mode === "garment" ? "garment" : "face";
  const mappings = Array.isArray(body.mappings)
    ? body.mappings
        .filter((m: any) => m && Number.isInteger(Number(m.videoIndex)) && Number.isInteger(Number(m.refIndex)))
        .slice(0, 10)
        .map((m: any) => ({ videoIndex: Number(m.videoIndex), refIndex: Number(m.refIndex) }))
    : [];
  const maxFrames = Math.min(1200, Math.max(30, Number(body.maxFrames) || 400));

  if (!videoUrlPath || !refPath) {
    return NextResponse.json({ error: "Missing videoPath or refPath" }, { status: 400 });
  }
  if (!mappings.length) {
    return NextResponse.json({ error: "Missing mappings", message: "حدد ربطاً واحداً على الأقل (فيديو ← مرجع)" }, { status: 400 });
  }

  const taskId = createTask(`Video ${mode === "face" ? "Face" : "Garment"} Swap`);
  updateTask(taskId, { status: "processing", progress: 2, label: taskId, phase: "prepare" });

  try {
    const videoAbs = await resolveFilePath(videoUrlPath);
    const refAbs = await resolveFilePath(refPath);
    const refBuf = await fs.readFile(refAbs);

    if (!(await spawnServiceIfDown())) {
      updateTask(taskId, { status: "error", error: "خدمة تبديل الفيديو غير متاحة" });
      return NextResponse.json({ taskId, error: "SERVICE_DOWN" }, { status: 503 });
    }

    const startRes = await fetch(`${MINI_SERVICE_URL}/video-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        video: videoAbs,
        ref: `data:image/png;base64,${refBuf.toString("base64")}`,
        mappings,
        maxFrames,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const startData: any = await startRes.json().catch(() => ({}));
    if (!startRes.ok || !startData?.ok || !startData?.jobId) {
      const msg = startData?.error || `HTTP ${startRes.status}`;
      updateTask(taskId, { status: "error", error: msg });
      return NextResponse.json({ taskId, error: "JOB_START_FAILED", message: msg }, { status: 500 });
    }

    // Return the taskId IMMEDIATELY — the frontend polls /api/task/status
    // while a background poller mirrors the python job's progress into it.
    updateTask(taskId, { status: "processing", progress: 3, phase: "queued" });
    void (async () => {
      const deadline = Date.now() + 30 * 60 * 1000;
      let misses = 0; // consecutive poll failures (service restarted / job lost)
      let lastProg = -1; // stale-progress watchdog state
      let lastChange = Date.now();
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1200));
        let job: any = null;
        try {
          const pr = await fetch(`${MINI_SERVICE_URL}/video-job/${startData.jobId}`, { signal: AbortSignal.timeout(10_000) });
          job = await pr.json().catch(() => null);
        } catch { /* transient — keep polling */ }
        if (!job?.ok) {
          misses++;
          // The python service was restarted or the job vanished — bail out
          // instead of polling a ghost for 30 minutes.
          if (misses >= 15) {
            updateTask(taskId, { status: "error", error: "فُقدت مهمة المعالجة (أعيد تشغيل الخدمة؟) — أعد المحاولة" });
            return;
          }
          continue;
        }
        misses = 0;
        updateTask(taskId, {
          status: job.status === "error" ? "error" : "processing",
          progress: Math.max(3, Math.min(99, job.progress ?? 3)),
          phase: job.phase ?? "processing",
          processedFrames: job.processedFrames,
          totalFrames: job.totalFrames,
        });
        // Watchdog: python worker alive but frozen (no progress change for
        // 4 min while not encoding) → fail the task with a clear message.
        const prog = job.progress ?? 0;
        if (prog !== lastProg) { lastProg = prog; lastChange = Date.now(); }
        else if (job.status === "processing" && job.phase !== "encoding" && Date.now() - lastChange > 240_000) {
          updateTask(taskId, { status: "error", error: "توقفت معالجة الفيديو عن التقدم — أعد المحاولة أو استخدم فيديو أقصر" });
          return;
        }
        if (job.status === "done" && job.result) {
          updateTask(taskId, { status: "done", progress: 100, phase: "done", result: job.result });
          // Result saved → sweep video files older than 30 min (sources,
          // intermediates, previous results) to free disk space.
          void sweepOldVideos(30).catch(() => {});
          return;
        }
        if (job.status === "error") {
          updateTask(taskId, { status: "error", error: job.error || "فشلت معالجة الفيديو" });
          return;
        }
      }
      updateTask(taskId, { status: "error", error: "انتهت المهلة (30 دقيقة)" });
    })();

    return NextResponse.json({ taskId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateTask(taskId, { status: "error", error: msg });
    return NextResponse.json({ taskId, error: "START_FAILED", message: msg }, { status: 500 });
  }
}
