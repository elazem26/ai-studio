import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GUARDIAN_SCRIPT = "/home/z/my-project/scripts/face-swap-guardian.py";
const GUARDIAN_PID_FILE = "/home/z/my-project/extracted/face-swap-guardian.pid";
const GUARDIAN_STATUS_FILE = "/home/z/my-project/extracted/face-swap-guardian-status.json";
const PYTHON_BIN = "/home/z/.venv/bin/python3";
const FACE_SWAP_SCRIPT = "/home/z/my-project/extracted/mini-services/face-swap-pro/server.py";

async function isGuardianRunning(): Promise<{ running: boolean; pid: number | null }> {
  try {
    const pidStr = await fs.readFile(GUARDIAN_PID_FILE, "utf-8");
    const pid = parseInt(pidStr.trim(), 10);
    if (!pid || Number.isNaN(pid)) return { running: false, pid: null };
    try {
      process.kill(pid, 0);
      return { running: true, pid };
    } catch {
      try { await fs.unlink(GUARDIAN_PID_FILE); } catch {}
      return { running: false, pid: null };
    }
  } catch {
    return { running: false, pid: null };
  }
}

async function startGuardian(): Promise<{ ok: boolean; pid: number | null }> {
  const { running, pid } = await isGuardianRunning();
  if (running) return { ok: true, pid };

  const child = spawn(PYTHON_BIN, [GUARDIAN_SCRIPT], {
    detached: true,
    stdio: "ignore",
    cwd: "/home/z/my-project/extracted",
  });
  child.unref();
  await new Promise(r => setTimeout(r, 3000));
  const status = await isGuardianRunning();
  return { ok: status.running, pid: status.pid };
}

async function stopGuardian(): Promise<boolean> {
  const { running, pid } = await isGuardianRunning();
  if (!running) return true;
  try {
    process.kill(pid as number, "SIGTERM");
    await new Promise(r => setTimeout(r, 2000));
    try { await fs.unlink(GUARDIAN_PID_FILE); } catch {}
    return true;
  } catch { return false; }
}

async function restartFaceSwapService(): Promise<boolean> {
  // Kill existing
  try { process.kill(0, 0); } catch {}
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    await execAsync("pkill -f face-swap-pro/server.py", { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
  } catch {}

  // Start fresh
  const child = spawn(PYTHON_BIN, [FACE_SWAP_SCRIPT], {
    detached: true,
    stdio: "ignore",
    cwd: "/home/z/my-project/extracted",
  });
  child.unref();
  await new Promise(r => setTimeout(r, 4000));

  // Check health
  try {
    const r = await fetch("http://localhost:3030/health", { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch { return false; }
}

export async function GET() {
  try {
    const { running, pid } = await isGuardianRunning();

    let status: any = null;
    try {
      const raw = await fs.readFile(GUARDIAN_STATUS_FILE, "utf-8");
      status = JSON.parse(raw);
    } catch {}

    // Also check the actual face-swap service
    let serviceHealthy = false;
    try {
      const r = await fetch("http://localhost:3030/health", { signal: AbortSignal.timeout(3000) });
      serviceHealthy = r.ok;
    } catch {}

    return NextResponse.json({
      ok: true,
      guardian: { running, pid },
      service_healthy: serviceHealthy,
      last_status: status,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = body.action;

  try {
    if (action === "start") {
      const result = await startGuardian();
      return NextResponse.json({ ok: result.ok, pid: result.pid, message: result.ok ? "Guardian started" : "Failed to start" });
    }

    if (action === "stop") {
      const ok = await stopGuardian();
      return NextResponse.json({ ok, message: ok ? "Guardian stopped" : "Failed to stop" });
    }

    if (action === "restart-service") {
      const ok = await restartFaceSwapService();
      return NextResponse.json({ ok, message: ok ? "Face-swap service restarted" : "Restart failed" });
    }

    if (action === "status") {
      const { running, pid } = await isGuardianRunning();
      let serviceHealthy = false;
      try {
        const r = await fetch("http://localhost:3030/health", { signal: AbortSignal.timeout(3000) });
        serviceHealthy = r.ok;
      } catch {}
      return NextResponse.json({
        ok: true,
        guardian_running: running,
        guardian_pid: pid,
        service_healthy: serviceHealthy,
      });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
