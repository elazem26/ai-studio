import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateToken } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { userId, otp } = await req.json();
    if (!userId || !otp) return NextResponse.json({ error: "userId و otp مطلوبان" }, { status: 400 });
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    if (user.isVerified) return NextResponse.json({ error: "الحساب مؤكد بالفعل" }, { status: 400 });
    if (!user.otpCode || user.otpCode !== otp) return NextResponse.json({ error: "رمز التأكيد غير صحيح" }, { status: 401 });
    if (user.otpExpiresAt && user.otpExpiresAt < new Date()) return NextResponse.json({ error: "انتهت صلاحية الرمز" }, { status: 401 });

    await db.user.update({ where: { id: userId }, data: { isVerified: true, otpCode: null, otpExpiresAt: null } });
    const token = generateToken();
    await db.setting.upsert({
      where: { key: `session:${token}` },
      create: { key: `session:${token}`, value: user.id },
      update: { key: `session:${token}`, value: user.id },
    });
    return NextResponse.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, isOwner: user.isOwner } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
