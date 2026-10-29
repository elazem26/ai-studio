/**
 * Shared utilities for video processing routes:
 * - Disk space pre-check (prevents ENOSPC errors)
 * - Old result file cleanup
 */

import { promises as fs, statSync } from "fs";
import path from "path";

const R = path.resolve(process.cwd(), "data/results");

/**
 * Get free disk space in bytes for the partition holding `dir`.
 * Returns -1 if not available.
 */
export async function getFreeDiskBytes(): Promise<number> {
  try {
    const { execFile } = await import("child_process");
    return new Promise((resolve) => {
      execFile("df", ["-B1", "--output=avail", R], { timeout: 5000 }, (err, stdout) => {
        if (err) { resolve(-1); return; }
        const lines = stdout.trim().split("\n");
        if (lines.length < 2) { resolve(-1); return; }
        const bytes = parseInt(lines[1].trim(), 10);
        resolve(isNaN(bytes) ? -1 : bytes);
      });
    });
  } catch { return -1; }
}

/**
 * Clean up old video result files (created by the various video services).
 * Keeps files modified within `maxAgeSec` seconds; deletes older ones.
 * This frees disk space BEFORE a new operation starts.
 *
 * @returns { freedBytes, deletedCount }
 */
export async function cleanOldVideoResults(maxAgeSec: number = 1800): Promise<{ freedBytes: number; deletedCount: number }> {
  let freedBytes = 0;
  let deletedCount = 0;
  const now = Date.now();
  const cutoff = now - maxAgeSec * 1000;

  try {
    const files = await fs.readdir(R).catch(() => [] as string[]);
    for (const f of files) {
      // Only delete files matching our video service prefixes
      if (!/^(vpreview-|venh-|vsplit-|vtrim-|vconv-|vmerge-|iconv-)/.test(f)) continue;

      const p = path.join(R, f);
      try {
        const stat = await fs.stat(p);
        if (!stat.isFile()) continue;
        if (stat.mtimeMs < cutoff) {
          // Old file — delete it
          await fs.unlink(p);
          freedBytes += stat.size;
          deletedCount++;
        }
      } catch {}
    }
  } catch {}

  return { freedBytes, deletedCount };
}

/**
 * Pre-flight disk check: cleans old files first, then verifies enough space.
 * Returns { ok, freeBytes, requiredBytes, message }.
 */
export async function prepareForUpload(requiredBytes: number): Promise<{
  ok: boolean;
  freeBytes: number;
  requiredBytes: number;
  message?: string;
}> {
  // Step 1: clean old files (older than 30 min)
  await cleanOldVideoResults(1800);

  // Step 2: check available disk space
  const freeBytes = await getFreeDiskBytes();
  if (freeBytes < 0) {
    // df failed — assume OK and let the write fail later
    return { ok: true, freeBytes: -1, requiredBytes };
  }

  // We need at least: requiredBytes (for the upload) + requiredBytes * 0.5 (for processing output)
  const minNeeded = Math.ceil(requiredBytes * 1.5);
  if (freeBytes < minNeeded) {
    return {
      ok: false,
      freeBytes,
      requiredBytes: minNeeded,
      message: `Insufficient disk space: ${Math.round(freeBytes / 1024 / 1024)}MB available, but ${Math.round(minNeeded / 1024 / 1024)}MB needed. Old files have been cleaned. Try a smaller file or delete unused results.`,
    };
  }

  return { ok: true, freeBytes, requiredBytes: minNeeded };
}
