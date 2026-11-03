import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: assistantId } = await params;
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const body = await req.json();
    const updateData: any = {};
    if (body.status) updateData.status = body.status;
    if (body.expiresAt) updateData.expiresAt = new Date(body.expiresAt);
    if (body.expiresAt === null) updateData.expiresAt = null;
    await db.assistant.update({ where: { id: assistantId }, data: updateData });

    if (body.permissions && Array.isArray(body.permissions)) {
      const assistant = await db.assistant.findUnique({ where: { id: assistantId } });
      if (assistant) {
        await db.permission.deleteMany({ where: { assistantId } });
        await db.permission.createMany({ data: body.permissions.map(key => ({ userId: assistant.userId, assistantId, key, value: true })) });
      }
    }
    return NextResponse.json({ ok: true, message: "تم تحديث المساعد" });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const assistant = await db.assistant.findUnique({ where: { id } });
    if (!assistant) return NextResponse.json({ error: "المساعد غير موجود" }, { status: 404 });
    await db.assistant.delete({ where: { id } });
    await db.user.delete({ where: { id: assistant.userId } }).catch(() => {});
    return NextResponse.json({ ok: true, message: "تم حذف المساعد" });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
