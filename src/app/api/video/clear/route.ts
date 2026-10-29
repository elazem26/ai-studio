import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const R = path.resolve(process.cwd(), "data/results");
const SESSIONS = path.resolve(process.cwd(), "data/sessions");

/**
 * POST /api/video/clear
 *
 * Body: { service: "generate" | "enhance" | "split" | "trim" | "merge" | "all" }
 *
 * Deletes uploaded files and results for the given video service to free disk space.
 *
 * Pattern matching by service:
 *   - generate: video-*.{mp4,png}, video-poster-*.png, video-preview-*.png
 *   - enhance:  venh-input-*, venh-*.mp4, venh-poster-*.png, venh-enhanced-*
 *   - split:    vsplit-input-*, vsplit-*-part*.mp4, vsplit-poster-*.png
 *   - trim:     vtrim-input-*, vtrim-*-part*.mp4, vtrim-*-result.mp4
 *   - merge:    data/sessions/<sessionId>/ (the entire session dir), vmerge-*-merged.mp4
 *   - all:      everything in data/results/ + data/sessions/
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const service: string = body.service || "all";

  let deletedCount = 0;
  let freedBytes = 0;
  const errors: string[] = [];

  try {
    await fs.mkdir(R, { recursive: true });

    if (service === "all") {
      // Delete everything in data/results/
      const files = await fs.readdir(R).catch(() => [] as string[]);
      for (const f of files) {
        try {
          const p = path.join(R, f);
          const stat = await fs.stat(p);
          if (stat.isFile()) {
            freedBytes += stat.size;
            await fs.unlink(p);
            deletedCount++;
          }
        } catch (e: any) {
          errors.push(`${f}: ${e.message}`);
        }
      }
      // Delete everything in data/sessions/
      const sessions = await fs.readdir(SESSIONS).catch(() => [] as string[]);
      for (const s of sessions) {
        try {
          const p = path.join(SESSIONS, s);
          const stat = await fs.stat(p);
          if (stat.isDirectory()) {
            // Recursively delete
            await fs.rm(p, { recursive: true, force: true });
            deletedCount++;
          }
        } catch (e: any) {
          errors.push(`${s}: ${e.message}`);
        }
      }
    } else {
      // Pattern-based deletion for a specific service
      const patterns: RegExp[] = (() => {
        switch (service) {
          case "generate":
            return [/^video-.*\.(mp4|png|webm)$/i, /^video-poster-.*\.png$/i, /^video-preview-.*\.png$/i];
          case "enhance":
            return [/^venh-input-/, /^venh-[^/]*\.(mp4|png|webm)$/i, /^venh-poster-.*\.png$/i, /^venh-enhanced-.*\.(mp4|png)$/i];
          case "split":
            return [/^vsplit-input-/, /^vsplit-[^/]*-part.*\.(mp4|png)$/i, /^vsplit-poster-.*\.png$/i];
          case "trim":
            return [/^vtrim-input-/, /^vtrim-[^/]*-part.*\.(mp4|png)$/i, /^vtrim-[^/]*-result\.(mp4|png)$/i, /^vtrim-[^/]*-extract\.(mp4|png)$/i, /^vtrim-[^/]*-empty\.png$/i, /^vtrim-[^/]*-list\.txt$/i];
          case "merge":
            return [/^vmerge-[^/]*-merged\.(mp4|png|webm)$/i];
          case "convert":
            return [/^vconv-input-/, /^vconv-[^/]*\.(mp4|png|webm|mkv|mov|avi|flv|wmv|m4v|3gp|3g2|ogv|ts|mpeg|mpg|m2ts|vob|mts|gif|mjpeg|f4v|asf)$/i];
          default:
            return [];
        }
      })();

      const files = await fs.readdir(R).catch(() => [] as string[]);
      for (const f of files) {
        if (patterns.some(p => p.test(f))) {
          try {
            const p = path.join(R, f);
            const stat = await fs.stat(p);
            if (stat.isFile()) {
              freedBytes += stat.size;
              await fs.unlink(p);
              deletedCount++;
            }
          } catch (e: any) {
            errors.push(`${f}: ${e.message}`);
          }
        }
      }

      // For merge: also delete the session dir
      if (service === "merge") {
        const sessions = await fs.readdir(SESSIONS).catch(() => [] as string[]);
        for (const s of sessions) {
          try {
            const p = path.join(SESSIONS, s);
            const stat = await fs.stat(p);
            if (stat.isDirectory()) {
              // Calculate size before deletion
              const walk = async (dir: string): Promise<number> => {
                let total = 0;
                const entries = await fs.readdir(dir).catch(() => [] as string[]);
                for (const e of entries) {
                  const ep = path.join(dir, e);
                  try {
                    const st = await fs.stat(ep);
                    if (st.isFile()) total += st.size;
                    else if (st.isDirectory()) total += await walk(ep);
                  } catch {}
                }
                return total;
              };
              freedBytes += await walk(p);
              await fs.rm(p, { recursive: true, force: true });
              deletedCount++;
            }
          } catch (e: any) {
            errors.push(`${s}: ${e.message}`);
          }
        }
      }
    }

    await logEvent({
      category: "video", level: "info",
      message: `Cleared service "${service}": ${deletedCount} files, ${(freedBytes / 1024 / 1024).toFixed(1)}MB freed`,
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      service,
      deletedCount,
      freedBytes,
      freedMB: parseFloat((freedBytes / 1024 / 1024).toFixed(2)),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : "Unknown",
    }, { status: 500 });
  }
}
