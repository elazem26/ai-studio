import { NextResponse } from "next/server";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { requireAdmin } from "@/lib/auth";
import { PROJECT_ROOT } from "@/lib/project-root";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");

/**
 * GET /api/system/download-part/<name>
 * Streams full-archive parts (ai-studio-complete.tar.gz.NN.part) and the
 * combine scripts from public/ — read from disk AT REQUEST TIME.
 *
 * Why not link to /<name> directly: the Next standalone server scans public/
 * once at startup, so parts written AFTER the server booted 404 forever.
 */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  const { name } = await params;
  // strict allow-list — no path traversal, only archive parts + combine scripts
  if (!/^(ai-studio-complete\.tar\.gz\.\d{2}\.part|combine-parts\.(sh|bat))$/.test(name)) {
    return NextResponse.json({ ok: false, error: "ملف غير معروف" }, { status: 400 });
  }

  const file = path.join(PUBLIC_DIR, name);
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("not a file");
    const stream = createReadStream(file);
    const readable = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "الجزء غير موجود — أعد فتح نافذة النسخة الكاملة لإعادة البناء" },
      { status: 404 }
    );
  }
}
