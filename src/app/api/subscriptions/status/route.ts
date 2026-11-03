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
    const user = await db.user.findUnique({ where: { id: session.value }, include: { subscription: true } });
    if (!user) return NextResponse.json({ error: "غير موجود" }, { status: 404 });
    const sub = user.subscription;
    const now = new Date();
    const isActive = user.isOwner || (sub && sub.status === "active" && sub.expiresAt > now);
    return NextResponse.json({
      isOwner: user.isOwner, isActive,
      plan: sub?.plan || (user.isOwner ? "owner" : "none"),
      expiresAt: sub?.expiresAt || null,
      priceUSD: sub?.priceUSD || 0,
    });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
