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
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && admin.role !== "assistant" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    const users = await db.user.findMany({
      select: { id: true, name: true, email: true, phone: true, role: true, isOwner: true, isSuspended: true, isVerified: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ users, total: users.length });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
