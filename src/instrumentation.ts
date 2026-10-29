/**
 * Next.js instrumentation hook — runs ONCE when Next.js boots.
 * Cross-platform: works on Linux (Z.ai) AND Windows (user's PC).
 * Uses eval() to bypass turbopack Edge runtime static analysis.
 */

export async function register() {
  if ((eval("process") as any).env.NEXT_RUNTIME !== "nodejs") return;
  if ((eval("process") as any).env.NODE_ENV === "test") return;

  const _require = (typeof eval !== "undefined") ? eval("require") : require;
  const _path = _require("path");
  const _process = eval("process") as any;
  const PROJECT_ROOT = _process.cwd();
  const SERVICE_SCRIPT = _path.join(PROJECT_ROOT, "mini-services", "face-swap-pro", "server.py");
  const GUARDIAN_SCRIPT = _path.join(PROJECT_ROOT, "scripts", "face-swap-guardian.py");
  const SERVICE_URL = "http://localhost:3030/health";
  const IS_WIN = _process.platform === "win32";
  const PYTHON = IS_WIN ? "python" : "/home/z/.venv/bin/python3";

  const log = (msg: string) => console.log(`[instrumentation] ${msg}`);

  // Step 0: Install insightface if missing
  try {
    const cp = _require("child_process");
    cp.execSync(`${PYTHON} -c "import insightface"`, { timeout: 5000, stdio: "pipe" });
    log("Python dependencies (insightface) already installed ✓");
  } catch {
    try {
      const cp = _require("child_process");
      log("insightface not found — installing...");
      cp.execSync(`${IS_WIN ? "pip" : "uv pip"} install insightface onnxruntime opencv-python`, { timeout: 120000, stdio: "pipe" });
      log("✓ insightface installed");
    } catch (e: any) {
      log(`⚠ install failed: ${e?.message || e}`);
    }
  }

  // Step 1: Check + spawn face-swap service
  try {
    const isUp = async () => {
      try {
        const r = await fetch(SERVICE_URL, { signal: AbortSignal.timeout(1500) });
        return r.ok;
      } catch { return false; }
    };

    if (await isUp()) {
      log("face-swap-pro service already running ✓");
    } else {
      log("face-swap-pro NOT running — spawning…");
      const cp = _require("child_process");
      const proc = cp.spawn(PYTHON, [SERVICE_SCRIPT], {
        cwd: PROJECT_ROOT, detached: true, stdio: "ignore",
        env: { ..._process.env, PYTHONUNBUFFERED: "1" },
      });
      proc.unref();
      log(`spawned face-swap-pro (PID ${proc.pid})`);
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (await isUp()) { log(`face-swap-pro healthy after ${(i+1)*2}s ✓`); break; }
      }
    }

    // Step 1.5: PRELOAD MODELS (fire-and-forget). Without this, models load
    // lazily on the user's FIRST detection — a 20-40s "upload is slow" wait.
    // Warming at boot means detection answers in ~1s from the very first use.
    try {
      const warm = await fetch("http://localhost:3030/warm", { signal: AbortSignal.timeout(5000) });
      log(`model warm-up started (${warm.ok ? "ok" : "HTTP " + warm.status}) — loading in background…`);
    } catch (e: any) { log(`⚠ warm call failed: ${e?.message || e}`); }
  } catch (e: any) { log(`⚠ face-swap spawn failed: ${e?.message || e}`); }

  // Step 2: Check + spawn guardian (Linux only)
  if (!IS_WIN) {
    try {
      const cp = _require("child_process");
      const guardianRunning = await new Promise<boolean>((resolve) => {
        cp.exec("pgrep -f face-swap-guardian", (err: any, stdout: string) => {
          resolve(!err && stdout.trim().length > 0);
        });
      });

      if (guardianRunning) {
        log("guardian already running ✓");
      } else {
        log("guardian NOT running — spawning…");
        const proc = cp.spawn(PYTHON, [GUARDIAN_SCRIPT], {
          cwd: PROJECT_ROOT, detached: true, stdio: "ignore",
          env: { ..._process.env, PYTHONUNBUFFERED: "1" },
        });
        proc.unref();
        log(`spawned guardian (PID ${proc.pid})`);
      }
    } catch (e: any) { log(`⚠ guardian spawn failed: ${e?.message || e}`); }
  } else {
    log("guardian not needed on Windows ✓");
  }

  log("=== instrumentation complete ===");
}
