import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization");
    const cookieToken = req.cookies.get("authToken")?.value || null;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : cookieToken;
    if (token) await db.setting.delete({ where: { key: `session:${token}` } }).catch(() => {});
    const res = NextResponse.json({ ok: true });
    res.cookies.set("authToken", "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  } catch { return NextResponse.json({ ok: true }); }
}
