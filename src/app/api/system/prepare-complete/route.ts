import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { execFile, spawn } from "child_process";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_FILE = "/home/z/my-project/extracted/public/ai-studio-complete-status.json";
const OUTPUT_FILE = "/home/z/my-project/extracted/public/ai-studio-complete.tar.gz";
const BUILD_SCRIPT = "/home/z/my-project/scripts/build-complete-tarball.sh";

async function isBuildRunning(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile("pgrep", ["-f", "build-complete-tarball.sh"], (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

async function triggerBuild(): Promise<void> {
  // Spawn the build script detached so it survives this request
  const child = spawn(
    "bash",
    [BUILD_SCRIPT],
    {
      cwd: "/home/z/my-project",
      detached: true,
      stdio: "ignore",
    }
  );
  child.unref();
}

/**
 * GET /api/system/prepare-complete
 *
 * Triggers a background build of the complete tarball if one isn't already running.
 * Returns the current status:
 *   - "not_started" → no build has run yet, triggering one now
 *   - "building"    → tarball is being created in the background
 *   - "ready"       → tarball is complete, includes direct_url + size
 *   - "failed"      → last build failed
 *
 * The frontend should poll this endpoint every 5s until status === "ready",
 * then redirect the user to direct_url for a real download with Content-Length.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  // Read current status
  let status: any = { status: "not_started" };
  try {
    const raw = await fs.readFile(STATUS_FILE, "utf-8");
    status = JSON.parse(raw);
  } catch {
    // No status file yet → not_started
  }

  // Check if a build is actually running
  const running = await isBuildRunning();

  // If status says building but no process is running, the build died
  if (status.status === "building" && !running) {
    // Check if the output file actually exists with reasonable size
    try {
      const stat = await fs.stat(OUTPUT_FILE);
      if (stat.size > 1_000_000) {
        // The build actually completed but status wasn't updated
        status = {
          status: "ready",
          size: stat.size,
          size_mb: Math.round(stat.size / 1024 / 1024),
          direct_url: "/ai-studio-complete.tar.gz",
          completed_at: new Date(stat.mtime).toISOString(),
        };
      } else {
        status = { status: "failed", error: "Build process died before completion" };
      }
    } catch {
      status = { status: "failed", error: "Build process died" };
    }
  }

  // If not started and no file exists, trigger a build
  if (status.status === "not_started" || status.status === "failed") {
    try {
      // Check if file already exists (size > 1MB) — if so, just return ready
      const stat = await fs.stat(OUTPUT_FILE);
      if (stat.size > 1_000_000) {
        return NextResponse.json({
          status: "ready",
          size: stat.size,
          size_mb: Math.round(stat.size / 1024 / 1024),
          direct_url: "/ai-studio-complete.tar.gz",
          completed_at: new Date(stat.mtime).toISOString(),
        });
      }
    } catch {
      // File doesn't exist
    }

    // Trigger a new build
    await triggerBuild();
    return NextResponse.json({
      status: "building",
      message: "Build started. Poll this endpoint every 5 seconds.",
      started_at: new Date().toISOString(),
      direct_url: "/ai-studio-complete.tar.gz",
    });
  }

  // If building, return current status
  if (status.status === "building") {
    // Try to report progress (file size growing)
    let currentBytes = 0;
    try {
      const stat = await fs.stat(OUTPUT_FILE);
      currentBytes = stat.size;
    } catch {}
    return NextResponse.json({
      status: "building",
      started_at: status.started_at,
      current_bytes: currentBytes,
      current_mb: Math.round(currentBytes / 1024 / 1024),
      message: "Tarball is being created. This takes 5-10 minutes for ~1.5GB.",
      direct_url: "/ai-studio-complete.tar.gz",
    });
  }

  // Ready
  if (status.status === "ready") {
    return NextResponse.json({
      status: "ready",
      size: status.size,
      size_mb: status.size_mb,
      file_count: status.file_count,
      direct_url: "/ai-studio-complete.tar.gz",
      completed_at: status.completed_at,
      started_at: status.started_at,
    });
  }

  return NextResponse.json(status);
}

/**
 * POST /api/system/prepare-complete
 *
 * Forces a rebuild (deletes the existing tarball and starts a new build).
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  // Delete existing file and status
  try {
    await fs.unlink(OUTPUT_FILE);
  } catch {}
  try {
    await fs.unlink(STATUS_FILE);
  } catch {}

  await triggerBuild();
  return NextResponse.json({
    status: "building",
    message: "Rebuild started. Poll GET /api/system/prepare-complete for status.",
    started_at: new Date().toISOString(),
  });
}