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
 *        instead of a cryptic JSON error.
 */

let busy = false;
let busySince = 0;
let busyOp = "";

/** Try to acquire the lock. Returns true if acquired, false if another op is running. */
export function tryAcquireProcessingLock(op: string = "operation"): boolean {
  if (busy) return false;
  busy = true;
  busySince = Date.now();
  busyOp = op;
  return true;
}

/** Release the lock. Safe to call multiple times. */
export function releaseProcessingLock(): void {
  busy = false;
  busySince = 0;
  busyOp = "";
}

/** Is currently busy? */
export function isProcessing(): boolean {
  return busy;
}

/** Get info about the current busy state (for diagnostics). */
export function getProcessingStatus(): { busy: boolean; op: string; since: number; elapsedMs: number } {
  return {
    busy,
    op: busyOp,
    since: busySince,
    elapsedMs: busy ? Date.now() - busySince : 0,
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
    releaseProcessingLock();
  }
}
