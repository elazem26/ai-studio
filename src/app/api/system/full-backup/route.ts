import { NextResponse } from "next/server";
import { buildCleanTarball, distributeToLocations, makeDownloadReady } from "@/lib/backup";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/system/full-backup
 *
 * SAFE operation (no deletion): clean backup → 6 locations + download copy.
 * Returns BOTH response shapes so old and new UI callers both work.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    const tar = await buildCleanTarball(true);
    const saved = await distributeToLocations(tar.file);
    const dl = await makeDownloadReady(tar.file).catch(() => null);
    import("fs").then(({ unlink }) => unlink(tar.file).catch(() => {}));
    const sizeKB = Math.round(tar.sizeBytes / 1024);
    return NextResponse.json({
      ok: saved.length > 0,
      // new shape
      savedCount: saved.length,
      savedLocations: saved.map((s) => ({ location: s.location, sizeBytes: s.sizeBytes })),
      // legacy shape
      sixLocationBackup: { path: saved[0]?.file ?? "", size: tar.sizeBytes, sizeKB },
      portableBackup: { path: dl?.file ?? "", size: dl?.sizeBytes ?? 0, sizeKB: Math.round((dl?.sizeBytes ?? 0) / 1024) },
      steps: [
        { step: "backup", ok: saved.length > 0, details: { savedCount: saved.length, sizeKB } },
        { step: "download-ready", ok: !!dl, details: { sizeKB: Math.round((dl?.sizeBytes ?? 0) / 1024) } },
      ],
      message: `نسخة نظيفة (${sizeKB}KB) في ${saved.length} مواقع`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "فشل النسخ الاحتياطي" }, { status: 500 });
  }
}