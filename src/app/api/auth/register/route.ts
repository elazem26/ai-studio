import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, generateOTP, ensureOwnerAccount } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, phone, name, password } = body;
    if (!password || password.length < 4) return NextResponse.json({ error: "كلمة المرور قصيرة جداً" }, { status: 400 });
    if (!email && !phone) return NextResponse.json({ error: "البريد أو الهاتف مطلوب" }, { status: 400 });

    await ensureOwnerAccount(db);

    const existing = await db.user.findFirst({
      where: { OR: [email ? { email } : {}, phone ? { phone } : {}].filter(o => Object.keys(o).length > 0) },
    });
    if (existing) return NextResponse.json({ error: "المستخدم مسجل بالفعل" }, { status: 409 });

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    const user = await db.user.create({
      data: { email: email || null, phone: phone || null, name: name || null, passwordHash: hashPassword(password), otpCode: otp, otpExpiresAt: otpExpires, isVerified: false, role: "user" },
    });
    await db.subscription.create({
      data: { userId: user.id, plan: "trial", status: "active", priceUSD: 0, expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) },
    });
    const allPerms = ["studio", "face_swap", "image_tools", "image_convert", "video_enhance", "video_split", "video_trim", "video_merge", "video_convert"];
    await db.permission.createMany({ data: allPerms.map(key => ({ userId: user.id, key, value: true })) });

    return NextResponse.json({ ok: true, userId: user.id, message: "تم إنشاء الحساب. أدخل رمز التأكيد.", otp });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "خطأ" }, { status: 500 });
  }
}
