import { NextResponse } from "next/server";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { execFile } from "child_process";
import { Readable } from "stream";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCRIPT = "/home/z/my-project/extracted/scripts/multi-location-backup.sh";

/**
 * GET /api/system/multi-backup-download
 *
 * Creates a fresh 6-location backup if no recent one exists (within last
 * 5 minutes), then streams the latest tarball back to the browser as a
 * downloadable attachment. This is the "download to computer" endpoint.
 *
 * The download copy lives at:
 *   /home/z/my-project/download/ai-studio-latest.tar.gz
 *
 * Filename pattern: ai-studio-YYYYMMDD-HHMMSS.tar.gz
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    const downloadDir = "/home/z/my-project/download";
    const latestPath = path.join(downloadDir, "ai-studio-latest.tar.gz");

    // Check if the latest backup is fresh (within 5 minutes)
    let needNew = true;
    try {
      const stat = await fs.stat(latestPath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (stat.size > 1000 && ageMs < 5 * 60 * 1000) {
        needNew = false;
      }
    } catch {}

    // If no fresh backup exists, run the script now
    if (needNew) {
      console.log("[/api/system/multi-backup-download] Generating fresh 6-location backup...");
      await fs.chmod(SCRIPT, 0o755).catch(() => {});
      const child = execFile("bash", [SCRIPT], {
        cwd: "/home/z/my-project",
        timeout: 300000,
        maxBuffer: 5 * 1024 * 1024,
      });
      await new Promise<void>((r) => {
        child.on("close", () => r());
        child.on("error", () => r());
      });
    }

    // Verify the download file exists now
    let stat;
    try {
      stat = await fs.stat(latestPath);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Backup file not found even after generation" },
        { status: 500 }
      );
    }
    if (stat.size < 1000) {
      return NextResponse.json(
        { ok: false, error: "Backup file is too small" },
        { status: 500 }
      );
    }

    // Generate a timestamped filename for the download
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")
      .replace("T", "-");
    const downloadName = `ai-studio-${ts}.tar.gz`;

    // Stream the file to the browser
    const stream = createReadStream(latestPath);
    const readable = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": stat.size.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}