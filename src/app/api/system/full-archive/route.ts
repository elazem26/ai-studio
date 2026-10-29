import { NextResponse } from "next/server";
import { getStatus, ensureBuilding } from "@/lib/full-archive";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/system/full-archive
 * Status of the FULL computer archive ("نسخة كمبيوتر كاملة").
 * First call starts the background build; subsequent calls poll status.
 * When ready, the parts are served statically from /public:
 *   /ai-studio-complete.tar.gz.NN.part  +  combine-parts.sh / .bat
 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });

  try {
    const status = await ensureBuilding();
    return NextResponse.json({ ok: true, ...status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "خطأ" }, { status: 500 });
  }
}