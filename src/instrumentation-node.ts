/**
 * Node-only instrumentation logic — imported dynamically from
 * instrumentation.ts ONLY when NEXT_RUNTIME === "nodejs".
 * Cross-platform: works on Linux (Z.ai) AND Windows (user's PC).
 */

import { execSync, spawn, exec } from "child_process";
import path from "path";
import { findMiniServiceScript, miniServiceRoot } from "@/lib/mini-service";

export async function registerNode() {
  const PROJECT_ROOT = miniServiceRoot();
  const SERVICE_SCRIPT = findMiniServiceScript();
  const GUARDIAN_SCRIPT = path.join(PROJECT_ROOT, "scripts", "face-swap-guardian.py");
  const SERVICE_URL = "http://localhost:3030/health";
  const IS_WIN = process.platform === "win32";

  const log = (msg: string) => console.log(`[instrumentation] ${msg}`);

  // Resolve a usable python3 per environment. The Z.ai sandbox has a venv at
  // /home/z/.venv (with insightface); Codespaces/PC have plain python3 on PATH.
  // Hardcoding the venv path made spawn() throw ENOENT uncaughtExceptions on
  // Codespaces (2026-11-02).
  const PYTHON = await (async () => {
    if (IS_WIN) return "python";
    const { existsSync } = await import("fs");
    if (existsSync("/home/z/.venv/bin/python3")) return "/home/z/.venv/bin/python3";
    for (const cand of ["python3", "python"]) {
      try {
        execSync(`${cand} -c "print(1)"`, { timeout: 5000, stdio: "pipe" });
        return cand;
      } catch { /* try next */ }
    }
    return "python3";
  })();
  log(`python resolved: ${PYTHON}`);

  // Step -1: REGRESSION GUARD — the upload route (and friends) got deleted on
  // disk 3+ times, breaking uploads/preview (المعاينة) on every fresh session.
  // The guard restores critical files from git BEFORE anything else runs.
  // (Linux only here; the Windows PC path has no git-delete history.)
  if (!IS_WIN) {
    try {
      execSync("bash scripts/verify-canonical.sh", {
        cwd: PROJECT_ROOT, timeout: 20000, stdio: "inherit",
      });
    } catch {
      log("⚠ verify-canonical failed at boot (non-fatal)");
    }
  }

  // Step 0: Install insightface if missing
  try {
    execSync(`${PYTHON} -c "import insightface"`, { timeout: 5000, stdio: "pipe" });
    log("Python dependencies (insightface) already installed ✓");
  } catch {
    try {
      log("insightface not found — installing...");
      const INSTALL_TIMEOUT = 600000; // codespace cold boot: numpy+onnxruntime download takes minutes
      const tryInstall = (cmd: string) => {
        try {
          execSync(cmd, { timeout: INSTALL_TIMEOUT, stdio: "pipe" });
          return true;
        } catch { return false; }
      };
      // Full face-swap service dependency set: web framework (fastapi/uvicorn/
      // python-multipart) + AI stack (insightface pulls numpy+opencv,
      // onnxruntime, pillow). insightface itself pulls non-headless opencv →
      // needs system libgl1 (installed by the apt strategy below).
      const PIP_PKGS = "fastapi uvicorn python-multipart pillow insightface onnxruntime opencv-python-headless";
      const ok =
        tryInstall(`${PYTHON} -m pip install ${PIP_PKGS}`) ||
        tryInstall(`${PYTHON} -m ensurepip --upgrade && ${PYTHON} -m pip install ${PIP_PKGS}`) ||
        // Debian-based devcontainers ship python3 WITHOUT pip AND without
        // ensurepip (2026-11-02, Codespaces): apt-install pip first. The
        // devcontainer user has passwordless sudo. libgl1: insightface pulls
        // non-headless opencv as its own dependency → cv2 import needs libGL.
        tryInstall("sudo apt-get update -qq && sudo apt-get install -y -qq python3-pip python3-venv libgl1 libglib2.0-0 && " + `${PYTHON} -m pip install --break-system-packages ${PIP_PKGS}`) ||
        (IS_WIN ? tryInstall(`pip install ${PIP_PKGS}`) : tryInstall(`uv pip install ${PIP_PKGS}`));
      // verify — only claim success when it actually imports
      if (ok) {
        try {
          execSync(`${PYTHON} -c "import insightface"`, { timeout: 10000, stdio: "pipe" });
          log("✓ insightface installed");
        } catch {
          log("⚠ install ran but insightface still not importable");
        }
      } else {
        log("⚠ all install strategies failed (no pip/uv available)");
      }
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
      const proc = spawn(PYTHON, [SERVICE_SCRIPT], {
        cwd: PROJECT_ROOT, detached: true, stdio: "ignore",
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      proc.on("error", (e) => log(`⚠ face-swap spawn error (non-fatal): ${e.message}`));
      proc.unref();
      log(`spawned face-swap-pro (PID ${proc.pid})`);
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (await isUp()) { log(`face-swap-pro healthy after ${(i+1)*2}s ✓`); break; }
      }
    }

    // NOTE: NO model warm-up here on purpose. At boot, free RAM looks plentiful
    // but turbopack compiles + next-server grow to ~1.5GB seconds later — the
    // 1.7-2GB model load races it and the kernel OOM-killer shoots next-server
    // mid-request (browser sees "Unexpected token '<'"). Warm-up now happens in
    // /api/system/ensure-services (page load), where server.py's own memory
    // guard (MIN_FREE_GB_TO_WARM) can judge accurately. Models always load
    // lazily on first face-swap use as a fallback.
  } catch (e: any) { log(`⚠ face-swap spawn failed: ${e?.message || e}`); }

  // Step 2: Check + spawn guardian (Linux only)
  if (!IS_WIN) {
    try {
      // ALWAYS spawn — the guardian dedupes itself via an exclusive flock on
      // data/guardian.lock (pgrep -f proved unreliable: it matches the boot
      // command line itself and wrongly reported "already running", leaving
      // the project with no watchdog and a dead :3000 → blank preview).
      if (await import("fs").then(fs => fs.existsSync(GUARDIAN_SCRIPT))) {
        const proc = spawn(PYTHON, [GUARDIAN_SCRIPT], {
          cwd: PROJECT_ROOT, detached: true, stdio: "ignore",
          env: { ...process.env, PYTHONUNBUFFERED: "1" },
        });
        proc.on("error", (e) => log(`⚠ guardian spawn error (non-fatal): ${e.message}`));
        proc.unref();
        log(`guardian spawn requested (PID ${proc.pid}) — flock dedupes instances`);
      } else {
        log(`⚠ guardian script missing: ${GUARDIAN_SCRIPT}`);
      }
    } catch (e: any) { log(`⚠ guardian spawn failed: ${e?.message || e}`); }
  } else {
    log("guardian not needed on Windows ✓");
  }

  log("=== instrumentation complete ===");
}
