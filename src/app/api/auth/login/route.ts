import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPassword, generateToken, ensureOwnerAccount } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, phone, password } = body;
    if (!password) return NextResponse.json({ error: "كلمة المرور مطلوبة" }, { status: 400 });

    await ensureOwnerAccount(db);

    const where: any = {};
    if (email) where.email = email;
    else if (phone) where.phone = phone;
    else if (email === "mohamed" || phone === "mohamed" || email === "mohammed" || phone === "mohammed") {
      where.name = "محمد";
      where.isOwner = true;
    } else {
      return NextResponse.json({ error: "البريد أو الهاتف مطلوب" }, { status: 400 });
    }

    let user = await db.user.findFirst({ where });
    if (!user && (email === "mohamed" || email === "mohammed" || phone === "mohamed" || phone === "mohammed")) {
      user = await db.user.findFirst({ where: { isOwner: true } });
    }
    if (!user) return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "كلمة المرور غير صحيحة" }, { status: 401 });
    }
    if (user.isSuspended) return NextResponse.json({ error: "الحساب موقوف. تواصل مع الإدارة." }, { status: 403 });
    if (!user.isVerified) {
      return NextResponse.json({ error: "الحساب غير مؤكد. يرجى التأكيد أولاً.", needsVerification: true, userId: user.id }, { status: 403 });
    }

    const token = generateToken();
    await db.setting.upsert({
      where: { key: `session:${token}` },
      create: { key: `session:${token}`, value: user.id },
      update: { key: `session:${token}`, value: user.id },
    });

    const res = NextResponse.json({
      ok: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, isOwner: user.isOwner },
    });
    // Persistent cookie — admin buttons keep working even if localStorage is cleared.
    // HTTPS (preview iframe) needs SameSite=None+Secure; localhost uses Lax.
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const isHttps = proto.includes("https");
    res.cookies.set("authToken", token, {
      httpOnly: true,
      sameSite: isHttps ? "none" : "lax",
      secure: isHttps,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "خطأ" }, { status: 500 });
  }
}
