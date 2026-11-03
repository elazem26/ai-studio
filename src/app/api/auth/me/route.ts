import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const user = await db.user.findUnique({
      where: { id: session.value },
      include: { subscription: true, permissions: true },
    });
    if (!user) return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    return NextResponse.json({
      id: user.id, name: user.name, email: user.email, phone: user.phone,
      role: user.role, isOwner: user.isOwner, isVerified: user.isVerified, isSuspended: user.isSuspended,
      subscription: user.subscription ? {
        plan: user.subscription.plan, status: user.subscription.status,
        expiresAt: user.subscription.expiresAt, priceUSD: user.subscription.priceUSD,
      } : null,
      permissions: user.permissions?.map(p => ({ key: p.key, value: p.value })) || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
