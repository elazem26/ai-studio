/**
 * Global processing lock — prevents concurrent heavy image/AI operations.
 *
 * Why this exists:
 *   The Z.ai container platform enforces a concurrency threshold.
 *   When two heavy operations (expand, face-swap, enhance, ...) overlap,
 *   the platform rejects the second with `ResourceExhausted` BEFORE the
 *   request reaches our Next.js app. By serializing heavy ops here, we:
 *     1. Prevent the platform-level ResourceExhausted error entirely.
 *     2. Give the user a friendly Arabic "try again in a moment" message
 *       instead of a cryptic JSON error.
 *
 * STALE-LOCK AUTO-EXPIRY (added after the "preview stopped working" bug):
 *   An async job that hangs forever (cloud AI call without a timeout,
 *   python service killed mid-request, ...) used to hold this lock
 *   FOREVER — every other heavy op then returned 429 until the whole
 *   server restarted. Now a lock held longer than the op's max hold time
 *   is considered stale and can be stolen by the next request.
 */

type MaxHold = { defaultMs: number; perOp?: Record<string, number> };

const MAX_HOLD: MaxHold = {
  // Video jobs legitimately run up to ~1h (maxDuration = 3600).
  defaultMs: 8 * 60 * 1000, // 8 min for every normal image/AI pipeline
  perOp: {
    "video-swap": 70 * 60 * 1000, // 70 min
    "garment-swap": 12 * 60 * 1000, // multi-person multi-ref pipelines can be slow
  },
};

let busy = false;
let busySince = 0;
let busyOp = "";

function maxHoldMs(op: string): number {
  return MAX_HOLD.perOp?.[op] ?? MAX_HOLD.defaultMs;
}

/**
 * Try to acquire the lock. Returns true if acquired, false if another op
 * is running. A STALE lock (held longer than the op's max hold time) is
 * stolen automatically so one hung job can never deadlock the studio.
 */
export function tryAcquireProcessingLock(op: string = "operation"): boolean {
  if (busy) {
    const heldMs = Date.now() - busySince;
    if (heldMs > maxHoldMs(busyOp)) {
      // Stale lock — steal it (the old job is hung; its finally, if it
      // ever fires, will just release the lock again, harmlessly).
      console.warn(
        `[processing-lock] STALE lock "${busyOp}" held for ${Math.round(heldMs / 1000)}s — stolen by "${op}"`
      );
      busy = false;
    } else {
      return false;
    }
  }
  busy = true;
  busySince = Date.now();
  busyOp = op;
  return true;
}

/** Release the lock — but ONLY if the caller still owns it. Safe to call multiple times. */
export function releaseProcessingLock(op?: string): void {
  if (op && busy && busyOp !== op) return; // someone else (a stealer) owns it now
  busy = false;
  busySince = 0;
  busyOp = "";
}

/** Is currently busy? */
export function isProcessing(): boolean {
  return busy;
}

/** Get info about the current busy state (for diagnostics). */
export function getProcessingStatus(): { busy: boolean; op: string; since: number; elapsedMs: number; staleInMs: number } {
  return {
    busy,
    op: busyOp,
    since: busySince,
    elapsedMs: busy ? Date.now() - busySince : 0,
    staleInMs: busy ? Math.max(0, maxHoldMs(busyOp) - (Date.now() - busySince)) : 0,
  };
}

/**
 * Helper: run a function under the processing lock.
 * If the lock is held, returns a 429-style error object instead of running.
 *
 * Usage:
 *   const result = await withProcessingLock("expand", async () => { ...heavy work... });
 *   if ("error" in result) return NextResponse.json(result, { status: 429 });
 */
export async function withProcessingLock<T>(
  op: string,
  fn: () => Promise<T>,
): Promise<T | { error: string; retryAfter: number; busyWith: string; elapsedMs: number }> {
  if (!tryAcquireProcessingLock(op)) {
    const status = getProcessingStatus();
    return {
      error: `عملية "${status.op}" جارية الآن (${Math.round(status.elapsedMs / 1000)}s). انتظر انتهاءها ثم أعد المحاولة.`,
      retryAfter: Math.max(5, Math.round(status.elapsedMs / 1000)),
      busyWith: status.op,
      elapsedMs: status.elapsedMs,
    };
  }
  try {
    return await fn();
  } finally {
    releaseProcessingLock(op);
  }
}
