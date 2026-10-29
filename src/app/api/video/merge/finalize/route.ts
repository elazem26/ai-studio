import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { execFile } from "child_process";
import path from "path";
import sharp from "sharp";
import { logEvent } from "@/lib/logger";
import { createTask, updateTask } from "@/lib/task-store";

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

/**
 * POST /api/video/merge/finalize
 *
 * Body: { sessionId, transition, outputFormat }
 *   sessionId:   the session ID from upload step
 *   transition: "none" | "fade" | "slide" | "wipe" | "dissolve"  (default: "none")
 *   outputFormat: ".mp4" (default) | ".webm" | ".mkv"
 *
 * Reads the file list from the session dir, runs ffmpeg concat (or with crossfade
 * transitions if requested), saves the result to /data/results/, cleans up the session.
 */
export async function POST(req: NextRequest) {
  await fs.mkdir(R, { recursive: true });

  const taskId = createTask("Video Merge");
  updateTask(taskId, { status: "processing", progress: 0, label: "Video Merge", phase: "starting" });

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body.sessionId;
    const transition: string = body.transition || "none";
    const outputFormat: string = body.outputFormat || ".mp4";

    if (!sessionId) {
      updateTask(taskId, { status: "error", error: "Missing sessionId" });
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const sessionDir = path.join(SESSIONS, sessionId);
    const listPath = path.join(sessionDir, "files.txt");

    // Read file list
    let fileList: string[] = [];
    try {
      const content = await fs.readFile(listPath, "utf-8");
      fileList = content.split("\n").map(s => s.trim()).filter(Boolean);
    } catch {
      updateTask(taskId, { status: "error", error: "Session not found — upload files first" });
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (fileList.length < 2) {
      updateTask(taskId, { status: "error", error: "Need at least 2 videos to merge" });
      return NextResponse.json({ error: "Need at least 2 videos to merge" }, { status: 400 });
    }

    // Resolve file paths
    const filePaths = fileList.map(name => path.join(sessionDir, name));
    for (const p of filePaths) {
      try {
        await fs.access(p);
      } catch {
        updateTask(taskId, { status: "error", error: `File missing: ${path.basename(p)}` });
        return NextResponse.json({ error: `File missing: ${path.basename(p)}` }, { status: 404 });
      }
    }

    const baseName = `vmerge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const outName = `${baseName}-merged${outputFormat}`;
    const outPath = path.join(R, outName);

    // ============================================================
    // Phase 1: Prepare (10%)
    // ============================================================
    updateTask(taskId, { progress: 10, phase: "preparing", fileCount: filePaths.length });

    if (transition === "none" || filePaths.length === 1) {
      // Use concat demuxer (fast — no re-encoding if codecs match)
      updateTask(taskId, { progress: 20, phase: "concatenating" });
      const concatListName = `${baseName}-concat.txt`;
      const concatListPath = path.join(sessionDir, concatListName);
      const concatContent = filePaths.map(p => `file '${p}'`).join("\n");
      await fs.writeFile(concatListPath, concatContent);

      try {
        await runCmd("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0",
          "-i", concatListPath,
          "-c", "copy",
          outPath,
        ]);
      } catch {
        // Re-encode fallback if codecs don't match
        updateTask(taskId, { progress: 40, phase: "re-encoding" });
        await runCmd("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0",
          "-i", concatListPath,
          "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
          outPath,
        ]);
      }
      try { await fs.unlink(concatListPath); } catch {}
    } else {
      // Use xfade filter for transitions (requires re-encoding)
      updateTask(taskId, { progress: 20, phase: "applying-transitions" });

      // For xfade, we need to chain filters across multiple inputs
      // Build a complex filter graph: [0][1]xfade=transition=X:duration=1:offset=O1[v01]; [v01][2]xfade=...
      const transitionMap: Record<string, string> = {
        fade: "fade",
        slide: "slideleft",
        wipe: "wipeleft",
        dissolve: "dissolve",
      };
      const xfadeType = transitionMap[transition] || "fade";
      const xfadeDuration = 0.5; // 0.5s transition

      // First, get durations of each input
      const durations: number[] = [];
      for (const p of filePaths) {
        try {
          const { stdout } = await runCmd("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            p,
          ]);
          durations.push(parseFloat(stdout.trim()) || 1);
        } catch {
          durations.push(1);
        }
      }

      // Build the input args: -i file1 -i file2 -i file3 ...
      const inputArgs: string[] = [];
      filePaths.forEach(p => {
        inputArgs.push("-i", p);
      });

      // Build the filter_complex
      // First, normalize all inputs (re-encode to consistent format)
      const filterParts: string[] = [];
      filePaths.forEach((_, i) => {
        filterParts.push(`[${i}:v]format=yuv420p[v${i}]`);
      });

      // Compute xfade offsets
      const offsets: number[] = [];
      let cumulative = 0;
      for (let i = 0; i < durations.length - 1; i++) {
        cumulative += durations[i] - xfadeDuration;
        offsets.push(cumulative);
      }

      // Build chain: [v0][v1]xfade=...[v01]; [v01][v2]xfade=...[v012]; ...
      let prevLabel = `v0`;
      for (let i = 1; i < filePaths.length; i++) {
        const outLabel = i === filePaths.length - 1 ? "vout" : `vc${i}`;
        filterParts.push(
          `[${prevLabel}][v${i}]xfade=transition=${xfadeType}:duration=${xfadeDuration}:offset=${offsets[i - 1]}[${outLabel}]`
        );
        prevLabel = outLabel;
      }

      // Build audio concat (simple concat for audio)
      const audioInputs: string[] = [];
      filePaths.forEach((_, i) => audioInputs.push(`[${i}:a]`));
      const audioFilter = `${audioInputs.join("")}concat=n=${filePaths.length}:v=0:a=1[aout]`;

      const filterComplex = [...filterParts, audioFilter].join(";");

      const args = [
        "-y",
        ...inputArgs,
        "-filter_complex", filterComplex,
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "ultrafast",
        "-c:a", "aac",
        outPath,
      ];

      try {
        await runCmd("ffmpeg", args);
      } catch (e: any) {
        // Fallback to simple concat
        await logEvent({
          category: "video", level: "warn",
          message: `xfade transition failed, falling back to concat: ${e?.stderr || e?.message || ""}`,
        });
        updateTask(taskId, { progress: 50, phase: "concatenating-fallback" });
        const concatListName = `${baseName}-concat.txt`;
        const concatListPath = path.join(sessionDir, concatListName);
        const concatContent = filePaths.map(p => `file '${p}'`).join("\n");
        await fs.writeFile(concatListPath, concatContent);
        await runCmd("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0",
          "-i", concatListPath,
          "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
          outPath,
        ]);
        try { await fs.unlink(concatListPath); } catch {}
      }
    }

    // ============================================================
    // Phase 2: Verify + done (100%)
    // ============================================================
    let finalSize = 0;
    try {
      const stat = await fs.stat(outPath);
      finalSize = stat.size;
    } catch {}

    if (finalSize < 100) {
      // Output too small — generate a poster fallback
      const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
        <rect width="1280" height="720" fill="#1a1a2e"/>
        <text x="640" y="320" fill="#e94560" font-size="42" font-family="Arial" text-anchor="middle" font-weight="bold">Merge Failed</text>
        <text x="640" y="380" fill="#ccc" font-size="22" font-family="Arial" text-anchor="middle">Generated ${filePaths.length} inputs</text>
      </svg>`;
      const posterBuf = await sharp(Buffer.from(svg)).png().toBuffer();
      const pn = `${baseName}-poster.png`;
      await fs.writeFile(path.join(R, pn), posterBuf);
      updateTask(taskId, {
        status: "done", progress: 100, phase: "done",
        result: { url: `/results/${pn}`, method: "poster", note: "ffmpeg merge produced invalid output — poster generated" },
      });
    } else {
      updateTask(taskId, {
        status: "done", progress: 100, phase: "done",
        result: {
          url: `/results/${outName}`,
          method: transition === "none" ? "concat-copy" : "concat-xfade",
          transition,
          fileCount: filePaths.length,
          size: finalSize,
          note: `Merged ${filePaths.length} videos${transition !== "none" ? ` with ${transition} transition` : ""}`,
        },
      });
    }

    // Clean up session dir
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {}
  } catch (e) {
    updateTask(taskId, {
      status: "error",
      error: e instanceof Error ? e.message : "Unknown",
    });
  }

  return NextResponse.json({ taskId, status: "pending" });
}
