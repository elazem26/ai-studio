import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { spawn, exec } from "child_process";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/proxy/self-heal — إصلاح تلقائي شامل (owner request 2026-11-02).
 *
 * POST (owner/admin) — kicks scripts/repair-and-restore.sh DETACHED:
 *   استعادة الملفات الحرجة من git → تحميل النماذج الناقصة → إعادة
 *   البناء إن لزم → إعادة تشغيل السيرفر → تحديث إحصائيات الإصلاح.
 * GET  — repair progress + stats (safe, read-only).
 */

const PROJECT = process.cwd().includes(".next/standalone")
  ? path.resolve(process.cwd(), "..", "..")
  : process.cwd();
const LOG = path.join(PROJECT, "data", "repair.log");
const SCRIPT = path.join(PROJECT, "scripts", "repair-and-restore.sh");

async function repairRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("pgrep -f repair-and-restore.sh", (err, stdout) => {
      resolve(!err && String(stdout).trim().length > 0);
    });
  });
}

async function logTail(): Promise<string[]> {
  try {
    const raw = await fs.readFile(LOG, "utf8");
    return raw.trim().split("\n").slice(-14);
  } catch {
    return [];
  }
}

async function stats() {
  try {
    const raw = await fs.readFile(path.join(PROJECT, "data", "repair-stats.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { lastRepairAt: null, totalRepairs: 0, lastResult: null };
  }
}

/** GET — progress + stats for the UI (read-only, no auth). */
export async function GET() {
  return NextResponse.json({
    repairRunning: await repairRunning(),
    logTail: await logTail(),
    repairStats: await stats(),
  });
}

/** POST — start the full self-heal (owner/admin only). */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user || !(user.isOwner || user.role === "admin" || user.role === "owner")) {
    return NextResponse.json(
      { error: "الإصلاح متاح لمالك المشروع فقط — سجّل الدخول بحساب المالك" },
      { status: 403 }
    );
  }
  if (await repairRunning()) {
    return NextResponse.json({ started: false, message: "الإصلاح جارٍ بالفعل — راقب الحالة" });
  }
  try {
    await fs.access(SCRIPT);
  } catch {
    return NextResponse.json({ error: "سكربت الإصلاح غير موجود" }, { status: 500 });
  }
  const child = spawn("setsid", ["nohup", "bash", SCRIPT], {
    cwd: PROJECT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  child.unref();
  return NextResponse.json({
    started: true,
    message: "بدأ الإصلاح الشامل — أبقِ الصفحة مفتوحة حتى إعادة التشغيل",
  });
}
