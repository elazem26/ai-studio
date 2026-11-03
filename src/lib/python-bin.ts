import { existsSync } from "fs";
import { spawn } from "child_process";

/**
 * python-bin — safe python resolution + crash-proof detached spawning.
 *
 * WHY THIS EXISTS (2026-11-03): every API route hardcoded
 * "/home/z/.venv/bin/python3". On Codespaces that binary does not exist, and
 * spawn() reports ENOENT via an ASYNC 'error' event — AFTER the caller's
 * try/catch has already moved on. An unhandled 'error' event on a
 * ChildProcess is a fatal uncaughtException: the whole next-server process
 * dies. Net effect: every keep-alive ping of /api/system/ensure-services was
 * nuking the web app on the public URL (probe 401 → ping → server dead).
 *
 * RULES:
 *  - NEVER hardcode the venv python path. Use getPythonBin().
 *  - NEVER call spawn() directly for background children. Use spawnSafe().
 */

let cached: string | null = null;

/** Resolve a usable python binary for THIS environment:
 *  - Z.ai sandbox: /home/z/.venv/bin/python3 (full insightface venv)
 *  - Codespaces / other Linux: python3 on PATH (instrumentation installs deps)
 *  - Windows: python
 *  Result is cached for the process lifetime. */
export function getPythonBin(): string {
  if (cached) return cached;
  if (process.platform === "win32") {
    cached = "python";
    return cached;
  }
  if (existsSync("/home/z/.venv/bin/python3")) {
    cached = "/home/z/.venv/bin/python3";
    return cached;
  }
  cached = "python3";
  return cached;
}

/** spawn() a background child that can NEVER crash the server: the ENOENT
 *  'error' event fires asynchronously, so we always attach a no-op handler. */
export function spawnSafe(
  cmd: string,
  args: string[],
  opts: Parameters<typeof spawn>[2] = {}
): ReturnType<typeof spawn> {
  const proc = spawn(cmd, args, opts);
  proc.on("error", () => {
    /* non-fatal by design — e.g. binary missing on this host */
  });
  return proc;
}
