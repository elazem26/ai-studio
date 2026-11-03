import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { buildCleanTarball } from "@/lib/backup";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/system/download-current
 * "نسخة كمبيوتر عادية" — fresh source backup (code + db + .env keys)
 * streamed directly to the user's computer as one small tar.gz.
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    const tar = await buildCleanTarball(true); // includes .env + db (owner request)
    const buf = await fs.readFile(tar.file);
    await fs.unlink(tar.file).catch(() => {});
    const name = `ai-studio-current-${new Date().toISOString().slice(0, 10)}.tar.gz`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "فشل بناء النسخة" }, { status: 500 });
  }
}