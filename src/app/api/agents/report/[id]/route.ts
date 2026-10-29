import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const user = await db.user.findUnique({ where: { id: session.value } });
    if (!user || (user.role !== "admin" && user.role !== "assistant" && !user.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    const report = await db.report.findUnique({ where: { id: params.id } });
    if (!report) return NextResponse.json({ error: "التقرير غير موجود" }, { status: 404 });
    return NextResponse.json({ report });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const user = await db.user.findUnique({ where: { id: session.value } });
    if (!user || (user.role !== "admin" && user.role !== "assistant" && !user.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    await db.report.delete({ where: { id: params.id } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
