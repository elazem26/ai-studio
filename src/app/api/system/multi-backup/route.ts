import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import { buildCleanTarball, distributeToLocations, sweepOldVideos } from "@/lib/backup";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/system/multi-backup
 *
 * Creates the CLEAN backup (source + db + configs only — no media, no
 * node_modules, no models) and saves it to the 6 on-disk locations.
 * Response shape consumed by the studio header button:
 *   { ok, savedCount, savedLocations: [{location, sizeBytes}], totalKB }
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  return NextResponse.json({ ok: true, endpoint: "/api/system/multi-backup", description: "نسخة نظيفة في 6 مواقع على القرص" });
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    // Free space first: sweep video files older than 30 min.
    await sweepOldVideos(30).catch(() => null);
    const tar = await buildCleanTarball(true);
    const saved = await distributeToLocations(tar.file);
    await fs.unlink(tar.file).catch(() => {});
    return NextResponse.json({
      ok: saved.length > 0,
      savedCount: saved.length,
      savedLocations: saved.map((s) => ({ location: s.location, sizeBytes: s.sizeBytes })),
      totalKB: Math.round((saved[0]?.sizeBytes ?? 0) / 1024),
      message: saved.length > 0
        ? `تم حفظ نسخة نظيفة في ${saved.length} مواقع (${Math.round((saved[0]?.sizeBytes ?? 0) / 1024)}KB)`
        : "فشل الحفظ في كل المواقع",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "فشل النسخ الاحتياطي" }, { status: 500 });
  }
}