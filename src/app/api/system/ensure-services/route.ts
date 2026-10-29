import { NextResponse } from "next/server";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MINI_SERVICE_HEALTH = "http://localhost:3030/health";
// Use the LIVE mini-services copy (not extracted/) so the spawned service
// always runs the latest code (/detect + face indices + mappings).
const SERVICE_SCRIPT = "/home/z/my-project/mini-services/face-swap-pro/server.py";
const SERVICE_CWD = "/home/z/my-project";
const GUARDIAN_SCRIPT = path.join(process.cwd(), "scripts", "face-swap-guardian.py");

async function isServiceUp(): Promise<boolean> {
  try {
    const r = await fetch(MINI_SERVICE_HEALTH, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function isGuardianUp(): Promise<boolean> {
  const { exec } = await import("child_process");
  return new Promise<boolean>((resolve) => {
    exec("pgrep -f face-swap-guardian", (err, stdout) => {
      resolve(!err && stdout.trim().length > 0);
    });
  });
}

async function spawnService(): Promise<number | null> {
  const { spawn } = await import("child_process");
  const proc = spawn(
    process.platform === "win32" ? "python" : "/home/z/.venv/bin/python3",
    [SERVICE_SCRIPT],
    {
      cwd: SERVICE_CWD,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    }
  );
  proc.unref();
  return proc.pid ?? null;
}

async function spawnGuardian(): Promise<number | null> {
  const { spawn } = await import("child_process");
  const proc = spawn(
    process.platform === "win32" ? "python" : "/home/z/.venv/bin/python3",
    [GUARDIAN_SCRIPT],
    {
      cwd: "/home/z/my-project",
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    }
  );
  proc.unref();
  return proc.pid ?? null;
}

/**
 * GET /api/system/ensure-services
 *
 * Lightweight "warm-up" endpoint that the frontend can call on page load.
 * It ensures the face-swap service is up before the user tries to use it.
 *
 * Behavior:
 *   1. Quick health check (1.5s timeout).
 *   2. If down — spawn it and wait up to 15s.
 *   3. Also spawn the guardian if it's not running.
 *   4. Return the status.
 *
 * This is the third layer (after instrumentation.ts + the route's own auto-start)
 * for ensuring the service is always up.
 */
export async function GET() {
  const startedAt = Date.now();
  const serviceUpBefore = await isServiceUp();
  const guardianUpBefore = await isGuardianUp();

  let servicePid: number | null = null;
  let guardianPid: number | null = null;

  // Spawn the service if down
  let serviceUpAfter = serviceUpBefore;
  if (!serviceUpBefore) {
    try {
      servicePid = await spawnService();
      // Wait up to 15s for it to come up
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await isServiceUp()) {
          serviceUpAfter = true;
          break;
        }
      }
    } catch {
      // ignore — leave serviceUpAfter = false
    }
  }

  // Spawn the guardian if down
  if (!guardianUpBefore) {
    try {
      guardianPid = await spawnGuardian();
    } catch {
      // ignore
    }
  }

  // PRELOAD MODELS in the background (fire-and-forget). Without this the
  // models load lazily on the FIRST detection request — a 20-40s wait that
  // users perceive as "upload is very slow". Warming here makes the first
  // upload respond in ~1s.
  if (serviceUpAfter) {
    fetch("http://localhost:3030/warm", { signal: AbortSignal.timeout(5000) })
      .then(() => {})
      .catch(() => {});
  }

  const elapsedMs = Date.now() - startedAt;

  return NextResponse.json({
    service: {
      wasUp: serviceUpBefore,
      isUp: serviceUpAfter,
      spawnedJustNow: !!servicePid,
      pid: servicePid,
    },
    guardian: {
      wasUp: guardianUpBefore,
      spawnedJustNow: !!guardianPid,
      pid: guardianPid,
    },
    elapsedMs,
    ok: serviceUpAfter,
  });
}
