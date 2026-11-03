import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken, PLANS } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const body = await req.json();
    const plan = PLANS.find(p => p.id === body.planId);
    if (!plan) return NextResponse.json({ error: "خطة غير صحيحة" }, { status: 400 });

    const sub = await db.subscription.upsert({
      where: { userId: session.value },
      create: { userId: session.value, plan: plan.id, status: "active", priceUSD: plan.price, expiresAt: new Date(Date.now() + plan.durationDays * 86400000) },
      update: { plan: plan.id, status: "active", priceUSD: plan.price, startedAt: new Date(), expiresAt: new Date(Date.now() + plan.durationDays * 86400000) },
    });
    return NextResponse.json({ ok: true, subscription: { plan: sub.plan, status: sub.status, expiresAt: sub.expiresAt, priceUSD: sub.priceUSD } });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
