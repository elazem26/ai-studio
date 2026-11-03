import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/images/clear-all
 *
 * Clears ALL uploaded and result images from the server's disk.
 * Called by the client when the browser tab is being closed
 * (via the `beforeunload` event) so the next session starts
 * with a clean slate.
 *
 * Deletes:
 *   - All files in data/uploads/
 *   - All files in data/results/
 *
 * Does NOT delete:
 *   - The database (db/custom.db) — keeps logs/settings
 *   - The vault backups (data/.vault/) — those are encrypted
 *     backups meant to survive session resets
 */
export async function POST(_req: NextRequest) {
  const UPLOADS_ROOT = path.resolve(process.cwd(), "data/uploads");
  const RESULTS_ROOT = path.resolve(process.cwd(), "data/results");

  let deletedUploads = 0;
  let deletedResults = 0;
  let freedBytes = 0;

  try {
    // Clear uploads
    try {
      const uploadFiles = await fs.readdir(UPLOADS_ROOT).catch(() => []);
      for (const f of uploadFiles) {
        const p = path.join(UPLOADS_ROOT, f);
        try {
          const stat = await fs.stat(p);
          if (stat.isFile()) {
            freedBytes += stat.size;
            await fs.unlink(p);
            deletedUploads++;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // uploads dir doesn't exist — that's fine
    }

    // Clear results
    try {
      const resultFiles = await fs.readdir(RESULTS_ROOT).catch(() => []);
      for (const f of resultFiles) {
        const p = path.join(RESULTS_ROOT, f);
        try {
          const stat = await fs.stat(p);
          if (stat.isFile()) {
            freedBytes += stat.size;
            await fs.unlink(p);
            deletedResults++;
          }
        } catch {
          // skip
        }
      }
    } catch {
      // results dir doesn't exist — that's fine
    }

    await logEvent({
      category: "upload",
      message: `Session cleared: ${deletedUploads} uploads + ${deletedResults} results (${Math.round(freedBytes / 1024)}KB freed)`,
    });

    return NextResponse.json({
      ok: true,
      deletedUploads,
      deletedResults,
      freedBytes,
    });
  } catch (e) {
    await logEvent({
      category: "upload",
      level: "error",
      message: "Clear-all failed",
      details: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
