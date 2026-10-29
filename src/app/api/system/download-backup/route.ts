import { NextResponse } from "next/server";
import { promises as fs, createReadStream } from "fs";
import { execFile } from "child_process";
import path from "path";
import { Readable } from "stream";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/download-backup
 * Returns the latest backup tarball for download to the user's computer.
 * If no backup exists, creates one on-the-fly via the multi-backup script.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  // Try the existing backup files (in order of preference)
  const candidates = [
    "/home/z/my-project/download/ai-studio-latest.tar.gz",
    "/home/z/my-project/extracted/backups/ai-studio-latest.tar.gz",
    "/home/z/my-project/extracted/public/backups/ai-studio-latest.tar.gz",
    "/home/z/my-project/extracted/public/download-backup.tar.gz",
  ];

  for (const p of candidates) {
    try {
      const stat = await fs.stat(p);
      if (stat.size > 1000) {
        const stream = createReadStream(p);
        const readable = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
        return new NextResponse(readable, {
          headers: {
            "Content-Type": "application/gzip",
            "Content-Disposition": `attachment; filename="${path.basename(p)}"`,
            "Content-Length": stat.size.toString(),
            "Cache-Control": "no-store",
          },
        });
      }
    } catch {}
  }

  // No existing backup — CREATE one by running the multi-backup script
  try {
    const scriptPath = "/home/z/my-project/extracted/scripts/multi-location-backup.sh";
    await fs.chmod(scriptPath, 0o755).catch(() => {});

    await new Promise<void>((resolve) => {
      const child = execFile("bash", [scriptPath], {
        cwd: "/home/z/my-project/extracted",
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
      });
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });

    // Now try again
    for (const p of candidates) {
      try {
        const stat = await fs.stat(p);
        if (stat.size > 1000) {
          const stream = createReadStream(p);
          const readable = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
          return new NextResponse(readable, {
            headers: {
              "Content-Type": "application/gzip",
              "Content-Disposition": `attachment; filename="${path.basename(p)}"`,
              "Content-Length": stat.size.toString(),
              "Cache-Control": "no-store",
            },
          });
        }
      } catch {}
    }

    return NextResponse.json(
      { ok: false, error: "No backup found and on-the-fly creation failed" },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}