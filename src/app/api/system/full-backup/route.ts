import { NextResponse } from "next/server";
import { buildCleanTarball, distributeToLocations } from "@/lib/backup";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/system/full-backup
 *
 * SAFE operation (no deletion): clean backup → EXACTLY 2 locations
 * (1 outside + 1 inside), latest-only, no dated duplicates.
 * Owner dedupe spec 2026-10-29. Returns BOTH response shapes so old
 * and new UI callers both work.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    const tar = await buildCleanTarball(true);
    const saved = await distributeToLocations(tar.file);
    import("fs").then((fs) => fs.promises.unlink(tar.file).catch(() => {}));
    const sizeKB = Math.round(tar.sizeBytes / 1024);
    return NextResponse.json({
      ok: saved.length > 0,
      // new shape
      savedCount: saved.length,
      savedLocations: saved.map((s) => ({ location: s.location, sizeBytes: s.sizeBytes })),
      // legacy shape (points at the first saved copy)
      sixLocationBackup: { path: saved[0]?.file ?? "", size: tar.sizeBytes, sizeKB },
      portableBackup: { path: saved[0]?.file ?? "", size: tar.sizeBytes, sizeKB },
      steps: [
        { step: "backup", ok: saved.length > 0, details: { savedCount: saved.length, sizeKB, locations: saved.map((s) => s.location) } },
      ],
      message: `نسخة نظيفة (${sizeKB}KB) في ${saved.length} مواقع (1 خارج + 1 داخل) — أحدث فقط`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "فشل النسخ الاحتياطي" }, { status: 500 });
  }
}
