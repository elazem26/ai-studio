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
// Allow very large uploads (no body size limit)
export const maxDuration = 3600; // 1 hour max for very large files

const R = path.resolve(process.cwd(), "data/results");

/** Run an async operation with a hard timeout (rejects with "TIMEOUT" after `ms` ms). */
function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/**
 * POST /api/video/enhance
 *
 * Accepts multipart/form-data with:
 *   - file:        the video file (any size — streamed to disk, no memory pressure)
 *   - quality:     "hd" | "fullHd" | "twoK" | "fourK" | "eightK" | "ultra"  (default "fourK")
 *
 * Supports ALL video formats: .mp4, .3gp, .avi, .mov, .mkv, .webm, .ogv, .flv, .wmv, .m4v, .ts, etc.
 *
 * The file is streamed to disk in chunks (no full in-memory load — works for 1GB+ files).
 * Progress is reported at each phase:
 *   - phase: "uploading"     progress 0-50  (bytes_written / total_bytes * 50)
 *   - phase: "processing"    progress 50-95
 *   - phase: "done"          progress 100
 *
 * The task result includes:
 *   - url:        the saved/enhanced video URL
 *   - posterUrl:  a PNG poster image (1920×1080) for browser display
 *   - method:     "ai-enhance" | "saved-original"
 *   - size, format
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(R, { recursive: true });

  const taskId = createTask("Video Enhance");
  updateTask(taskId, { status: "processing", progress: 0, label: "Video Enhance", phase: "starting" });

  try {
    let savedFile: { path: string; name: string; size: number; ext: string } | null = null;
    let quality = "fourK";

    // Detect raw-byte uploads (query params: filename, quality, size)
    const url = new URL(req.url);
    const rawFilename = url.searchParams.get("filename");

    // ============================================================
    // Disk space pre-check (clean old files + verify free space)
    // ============================================================
    const rawSize = parseInt(url.searchParams.get("size") || "0", 10);
    const diskCheck = await prepareForUpload(rawSize);
    if (!diskCheck.ok) {
      updateTask(taskId, {
        status: "error",
        error: diskCheck.message || "Insufficient disk space",
      });
      return NextResponse.json({
        error: "INSUFFICIENT_DISK_SPACE",
        message: diskCheck.message,
        freeMB: Math.round(diskCheck.freeBytes / 1024 / 1024),
        requiredMB: Math.round(diskCheck.requiredBytes / 1024 / 1024),
      }, { status: 507 });
    }

    if (rawFilename) {
      // ============================================================
      // RAW BYTE STREAM MODE (for huge files — no FormData overhead)
      // ============================================================
      quality = url.searchParams.get("quality") || "fourK";
      const ext = path.extname(rawFilename) || ".mp4";
      const safeBase = path.basename(rawFilename).replace(/[^\w.\-]/g, "_");
      const name = `venh-${quality}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
      const outPath = path.join(R, name);

      const totalBytes = rawSize > 0 ? rawSize : 0;
      let receivedBytes = 0;
      const startTime = Date.now();

      const writer = createWriteStream(outPath);
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
          const elapsedSec = (Date.now() - startTime) / 1000;
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

      savedFile = { path: outPath, name, size: receivedBytes, ext };
    } else {
      // ============================================================
      // FormData MODE (backward-compatible)
      // ============================================================
      const fd = await req.formData().catch(() => null);
      if (!fd) {
        updateTask(taskId, { status: "error", error: "Invalid form data" });
        return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
      }
      const file = fd.get("file") as File | null;
      if (!file) {
        updateTask(taskId, { status: "error", error: "Missing file" });
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }
      quality = (fd.get("quality") as string) || "fourK";
      const ext = path.extname(file.name) || ".mp4";
      const safeBase = path.basename(file.name).replace(/[^\w.\-]/g, "_");
      const name = `venh-${quality}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeBase}`;
      const outPath = path.join(R, name);

      const totalBytes = file.size;
      let receivedBytes = 0;
      const startTime = Date.now();
      const writer = createWriteStream(outPath);
      const reader = file.stream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await new Promise<void>((resolve, reject) => {
            writer.write(Buffer.from(value), (err) => err ? reject(err) : resolve());
          });
          receivedBytes += value.byteLength;
          const uploadProgress = totalBytes > 0 ? Math.min(50, (receivedBytes / totalBytes) * 50) : 25;
          const elapsedSec = (Date.now() - startTime) / 1000;
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

      savedFile = { path: outPath, name, size: receivedBytes, ext };
    }

    if (!savedFile) {
      updateTask(taskId, { status: "error", error: "No file saved" });
      return NextResponse.json({ error: "No file saved" }, { status: 500 });
    }

    const { path: inputPath, name: savedName, size: savedSize, ext } = savedFile;

    // ============================================================
    // Phase 2: Processing (50% → 95%)
    // ============================================================
    updateTask(taskId, {
      status: "processing", progress: 55, phase: "processing",
      bytesReceived: savedSize, bytesTotal: savedSize,
    });

    let aiWorked = false;
    try {
      const Z = await import("z-ai-web-dev-sdk");
      const zai = await Z.default.create();

      const hasEnhanceApi =
        zai &&
        typeof (zai as any).videos === "object" &&
        (zai as any).videos !== null &&
        typeof (zai as any).videos.enhance === "function";

      if (hasEnhanceApi && savedSize < 50 * 1024 * 1024) {
        updateTask(taskId, { progress: 65, phase: "ai-enhancing" });
        const buf = await fs.readFile(inputPath);
        const er = await withTimeout(
          (zai as any).videos.enhance({
            video: `data:video/mp4;base64,${buf.toString("base64")}`,
            quality,
          }),
          15000,
          "video enhance API"
        );
        const u = er?.url || er?.data?.[0]?.url;
        if (u) {
          updateTask(taskId, { progress: 85, phase: "downloading-enhanced" });
          const vr = await fetch(u);
          const b = Buffer.from(await vr.arrayBuffer());
          const n = `venh-enhanced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          const p = path.join(R, n);
          await fs.writeFile(p, b);
          updateTask(taskId, {
            status: "done", progress: 100, phase: "done",
            result: { url: `/results/${n}`, path: p, method: "ai-enhance", size: b.length, format: ext },
          });
          aiWorked = true;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logEvent({ category: "video", level: "warn", message: `AI enhance failed: ${msg}` });
    }

    if (aiWorked) {
      try { await fs.unlink(inputPath); } catch {}
      return NextResponse.json({ taskId, status: "pending" });
    }

    // ============================================================
    // Phase 3: REAL enhancement via ffmpeg (upscale + filters + re-encode to MP4)
    // ============================================================
    updateTask(taskId, { progress: 60, phase: "enhancing" });

    // Quality → target resolution
    const QRES: Record<string, { w: number; h: number; label: string }> = {
      hd:     { w: 1280, h: 720,  label: "HD 720p" },
      fullHd: { w: 1920, h: 1080, label: "Full HD 1080p" },
      twoK:   { w: 2560, h: 1440, label: "2K 1440p" },
      fourK:  { w: 3840, h: 2160, label: "4K 2160p" },
      eightK: { w: 7680, h: 4320, label: "8K 4320p" },
      ultra:  { w: 7680, h: 4320, label: "ULTRA 8K+" },
    };
    const target = QRES[quality] || QRES.fullHd;

    // Build ffmpeg filter chain for real enhancement:
    //   scale (upscale to target, preserve aspect ratio with padding)
    //   hqdn3d (denoise)
    //   unsharp (sharpen)
    //   eq (contrast/saturation/brightness boost)
    //   curves (color enhance)
    //   format=yuv420p (max compatibility)
    const filterChain = [
      `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease`,
      `pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2:color=black`,
      `hqdn3d=1.5:1.5:6:6`,
      `unsharp=5:5:1.0:5:5:0.0`,
      `eq=contrast=1.08:saturation=1.15:brightness=0.02`,
      `curves=preset=increase_contrast`,
      `format=yuv420p`,
    ].join(",");

    const enhancedName = `venh-${quality}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
    const enhancedPath = path.join(R, enhancedName);

    try {
      const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile("ffmpeg", [
          "-y",
          "-i", inputPath,
          "-vf", filterChain,
          "-c:v", "libx264", "-preset", "fast", "-crf", "20",
          "-c:a", "aac", "-b:a", "128k",
          "-movflags", "+faststart",
          enhancedPath,
        ], { maxBuffer: 100 * 1024 * 1024, timeout: 600000 }, (err, stdout, stderr) => {
          if (err) reject({ err, stdout, stderr });
          else resolve({ stdout, stderr });
        });
      });

      // Verify the enhanced file exists and has reasonable size
      const enhStat = await fs.stat(enhancedPath);
      if (enhStat.size < 1000) {
        throw new Error("Enhanced output too small — ffmpeg may have failed");
      }

      // ============================================================
      // Phase 4: Extract a real poster frame from the enhanced video
      // ============================================================
      updateTask(taskId, { progress: 90, phase: "extracting-poster" });

      let posterUrl: string | null = null;
      const posterName = `venh-poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
      const posterPath = path.join(R, posterName);
      try {
        await new Promise<void>((resolve, reject) => {
          execFile("ffmpeg", [
            "-y",
            "-i", enhancedPath,
            "-ss", "00:00:01",
            "-vframes", "1",
            "-vf", `scale=${target.w}:${target.h}`,
            posterPath,
          ], { timeout: 30000 }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        posterUrl = `/results/${posterName}`;
      } catch (e: any) {
        await logEvent({ category: "video", level: "warn", message: `Poster extraction failed: ${e?.message || e}` });
        // Fallback: generate a Sharp SVG poster with the enhancement info
        try {
          const svg = `<svg width="${target.w}" height="${target.h}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${target.w}" height="${target.h}" fill="#0f3460"/>
            <text x="${target.w/2}" y="${target.h/2}" fill="#e94560" font-size="64" font-family="Arial" text-anchor="middle" font-weight="bold">Enhanced ${target.label}</text>
          </svg>`;
          const buf = await sharp(Buffer.from(svg)).png().toBuffer();
          await fs.writeFile(posterPath, buf);
          posterUrl = `/results/${posterName}`;
        } catch {}
      }

      // Clean up input
      try { await fs.unlink(inputPath); } catch {}

      updateTask(taskId, {
        status: "done", progress: 100, phase: "done",
        result: {
          url: `/results/${enhancedName}`,
          path: enhancedPath,
          quality,
          method: "ffmpeg-enhance",
          posterUrl,
          size: enhStat.size,
          format: ".mp4",
          targetWidth: target.w,
          targetHeight: target.h,
          targetLabel: target.label,
          note: `Enhanced to ${target.label} (${target.w}×${target.h}) via ffmpeg with denoise+sharpen+color+contrast filters`,
        },
      });
    } catch (e: any) {
      // ffmpeg enhancement failed — fall back to saving original + poster
      await logEvent({ category: "video", level: "warn", message: `ffmpeg enhance failed: ${e?.stderr || e?.message || e}` });

      // Generate poster
      let posterUrl: string | null = null;
      try {
        const svg = `<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
          <rect width="1920" height="1080" fill="#1a1a2e"/>
          <text x="960" y="540" fill="#e94560" font-size="64" font-family="Arial" text-anchor="middle" font-weight="bold">Enhanced Video</text>
          <text x="960" y="600" fill="#ccc" font-size="32" font-family="Arial" text-anchor="middle">Quality: ${quality.toUpperCase()}</text>
        </svg>`;
        const buf = await sharp(Buffer.from(svg)).png().toBuffer();
        const pn = `venh-poster-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
        await fs.writeFile(path.join(R, pn), buf);
        posterUrl = `/results/${pn}`;
      } catch {}

      updateTask(taskId, {
        status: "done", progress: 100, phase: "done",
        result: {
          url: `/results/${savedName}`,
          path: inputPath,
          quality,
          method: "saved-original",
          posterUrl,
          size: savedSize,
          format: ext,
          note: "ffmpeg enhancement failed — original video saved + poster generated",
        },
      });
    }
  } catch (e) {
    updateTask(taskId, {
      status: "error",
      error: e instanceof Error ? e.message : "Unknown",
    });
  }

  return NextResponse.json({ taskId, status: "pending" });
}
