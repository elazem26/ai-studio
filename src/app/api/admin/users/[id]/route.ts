import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const body = await req.json();
    const target = await db.user.findUnique({ where: { id: params.id } });
    if (!target) return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    if (target.isOwner) return NextResponse.json({ error: "لا يمكن تعديل حساب المالك" }, { status: 403 });

    const updateData: any = {};
    if (typeof body.isSuspended === "boolean") updateData.isSuspended = body.isSuspended;
    if (typeof body.isVerified === "boolean") updateData.isVerified = body.isVerified;
    if (body.role) updateData.role = body.role;
    await db.user.update({ where: { id: params.id }, data: updateData });
    return NextResponse.json({ ok: true, message: "تم التحديث" });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const target = await db.user.findUnique({ where: { id: params.id } });
    if (!target) return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    if (target.isOwner) return NextResponse.json({ error: "لا يمكن حذف حساب المالك" }, { status: 403 });
    await db.user.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true, message: "تم الحذف" });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
