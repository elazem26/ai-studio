import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken, hashPassword, PERMISSION_KEYS } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const user = await db.user.findUnique({ where: { id: session.value } });
    if (!user || (user.role !== "admin" && user.role !== "assistant" && !user.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const assistants = await db.assistant.findMany({
      include: { user: true, permissions: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ assistants: assistants.map(a => ({
      id: a.id, name: a.name, status: a.status, expiresAt: a.expiresAt,
      email: a.user.email, phone: a.user.phone,
      permissions: a.permissions.map(p => ({ key: p.key, value: p.value })),
      createdAt: a.createdAt,
    }))});
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const body = await req.json();
    const { name, email, phone, password, permissions, expiresAt } = body;
    if (!name || !password) return NextResponse.json({ error: "الاسم وكلمة المرور مطلوبان" }, { status: 400 });

    const assistantUser = await db.user.create({
      data: { name, email: email || null, phone: phone || null, passwordHash: hashPassword(password), role: "assistant", isVerified: true },
    });
    const assistant = await db.assistant.create({
      data: { userId: assistantUser.id, managedBy: admin.id, name, status: "active", expiresAt: expiresAt ? new Date(expiresAt) : null },
    });
    if (permissions && Array.isArray(permissions)) {
      await db.permission.createMany({ data: permissions.map(key => ({ userId: assistantUser.id, assistantId: assistant.id, key, value: true })) });
    } else {
      const allKeys = PERMISSION_KEYS.filter(p => p.key !== "admin").map(p => p.key);
      await db.permission.createMany({ data: allKeys.map(key => ({ userId: assistantUser.id, assistantId: assistant.id, key, value: true })) });
    }
    return NextResponse.json({ ok: true, assistantId: assistant.id, message: "تم إنشاء المساعد بنجاح" });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
