import { NextResponse } from "next/server";
import { promises as fs, createReadStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { requireAdmin } from "@/lib/auth";
import { getAppVersion, DOWNLOAD_DIR } from "@/lib/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/download-pc
 * Serves the complete PC package: AI-Studio-v<version>.tar.gz
 * (~770MB: code + db + .env + models + one-click launchers).
 * Button 3 of the Quick-Launch set ("تشغيل من الكمبيوتر").
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  const version = await getAppVersion();
  const file = path.join(DOWNLOAD_DIR, `AI-Studio-v${version}.tar.gz`);

  try {
    const stat = await fs.stat(file);
    const stream = createReadStream(file);
    const readable = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    return new NextResponse(readable, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="AI-Studio-v${version}.tar.gz"`,
        "Content-Length": String(stat.size),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: `حزمة الكمبيوتر غير موجودة بعد. اضغط "إنهاء الجلسة" لبنائها، أو استخدم "تحميل النسخة الحالية".`,
      },
      { status: 404 }
    );
  }
}
