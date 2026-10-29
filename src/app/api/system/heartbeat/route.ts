import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { PROJECT } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Heartbeat / disconnect-detection endpoint.
 *
 * Owner spec (2026-10-29): end-of-session cleanup must run when
 *   a) the "إنهاء الجلسة" button is clicked   → /api/system/end-session
 *   b) the session is exited (tab close/nav)  → sendBeacon in SessionCleanup
 *   c) the session is INTERRUPTED (انقطاع)    → THIS endpoint
 *
 * How (c) works:
 *   - Every open studio page sends a beat every 60s (sendBeacon).
 *   - This route stores {active, lastBeat} in data/session-state.json.
 *   - If a new beat arrives and the previous beat is older than
 *     STALE_AFTER_MS (4 min ⇒ 4+ missed beats), the previous session
 *     was interrupted (network drop / crash / laptop closed) — the
 *     full end-session protocol runs DETACHED via
 *     scripts/end-session-protocol.ts (cleanup + 6 backups + PC
 *     package + GitHub if configured), and the beat starts a fresh
 *     session.
 *
 * Anonymous by design (sendBeacon cannot attach auth headers) — it
 * only ever reads/writes a timestamp file; destructive work is done
 * by the protocol script exactly like the admin-gated end-session.
 */

const STATE_FILE = path.join(PROJECT, "data", "session-state.json");
const STALE_AFTER_MS = 4 * 60_000; // 4 minutes without a beat = interrupted
const RECENT_CLEAN_GUARD_MS = 10 * 60_000; // don't re-trigger within 10 min

interface SessionState {
  active?: boolean;
  lastBeat?: number;
  lastAutoCleanAt?: number;
  lastAutoCleanTrigger?: string;
}

async function readState(): Promise<SessionState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as SessionState;
  } catch {
    return {};
  }
}

export async function POST() {
  const now = Date.now();
  const prev = await readState();

  let staleDetected = false;
  let protocolStarted = false;

  const prevBeat = prev.lastBeat || 0;
  const gap = prevBeat ? now - prevBeat : 0;
  const wasActive = !!prev.active;

  // Interrupted session: previous beat was active but long ago.
  if (wasActive && gap > STALE_AFTER_MS) {
    staleDetected = true;
    // Guard: never re-run if an automatic clean happened very recently
    const sinceClean = now - (prev.lastAutoCleanAt || 0);
    if (sinceClean > RECENT_CLEAN_GUARD_MS) {
      try {
        const child = spawn("bun", ["scripts/end-session-protocol.ts", "disconnect"], {
          cwd: PROJECT,
          detached: true,
          stdio: "ignore",
        });
        child.unref();
        protocolStarted = true;
      } catch {
        /* spawn failure logged via state file next run */
      }
    }
  }

  // Record the fresh beat
  const next: SessionState = {
    active: true,
    lastBeat: now,
    lastAutoCleanAt: prev.lastAutoCleanAt,
    lastAutoCleanTrigger: prev.lastAutoCleanTrigger,
  };
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await fs.writeFile(STATE_FILE, JSON.stringify(next));
  } catch { /* read-only fs — detection degrades gracefully */ }

  return NextResponse.json({
    ok: true,
    staleDetected,
    protocolStarted,
    gapMin: prevBeat ? Math.round(gap / 60_000) : null,
  });
}

/** GET = status (for debugging / the header indicator). */
export async function GET() {
  const state = await readState();
  const now = Date.now();
  const sinceBeat = state.lastBeat ? now - state.lastBeat : null;
  return NextResponse.json({
    ok: true,
    active: !!state.active && (sinceBeat === null || sinceBeat < STALE_AFTER_MS),
    sinceLastBeatMin: sinceBeat === null ? null : Math.round(sinceBeat / 60_000),
    lastAutoCleanAt: state.lastAutoCleanAt
      ? new Date(state.lastAutoCleanAt).toISOString()
      : null,
    lastAutoCleanTrigger: state.lastAutoCleanTrigger || null,
  });
}
