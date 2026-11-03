import fs from "fs";
import path from "path";

/**
 * Locate mini-services/face-swap-pro/server.py across ALL deployment layouts.
 *
 * The Next server can run with cwd = project root (start-production.sh) OR
 * with cwd = .next/standalone (platform bootstrap). The standalone layout
 * does NOT contain mini-services (excluded from output tracing to keep the
 * bundle lean), so the script must be found by walking up from there.
 *
 * Fixes: "numbered boxes disappeared" — the auto-spawn used to compute
 * cwd/mini-services/... which does not exist when cwd = .next/standalone,
 * so the service never came up and /api/images/face-detect returned 503.
 */
export function findMiniServiceScript(): string {
  const rel = path.join("mini-services", "face-swap-pro", "server.py");
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, rel), // project root (normal run)
    path.join(cwd, "..", "..", rel), // cwd = .next/standalone
    path.join(cwd, "..", rel), // cwd = .next
  ];
  // CANONICAL SOURCE RULE (2026-11-01): never resolve to a copy INSIDE .next —
  // those are stale build leftovers that lag behind the real source and caused
  // "fixes disappear / feature breaks in every new session" regressions
  // (the running service kept old code while edits landed in the project tree).
  const resolved = candidates.map((c) => {
    try {
      return path.resolve(c);
    } catch {
      return c;
    }
  });
  for (const c of resolved) {
    if (c.includes(`${path.sep}.next${path.sep}`)) continue; // stale copy — skip
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return resolved[0]; // best guess — spawn error will name the path
}

/** Project root that actually contains mini-services/ (for spawn cwd). */
export function miniServiceRoot(): string {
  return path.dirname(path.dirname(path.dirname(findMiniServiceScript())));
}
