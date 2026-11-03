import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT = process.cwd().includes(".next/standalone")
  ? path.resolve(process.cwd(), "..", "..")
  : process.cwd();
const LOG = path.join(PROJECT, "data", "repair.log");
const SCRIPT = path.join(PROJECT, "scripts", "repair-and-restore.sh");

async function repairRunning(): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    return await new Promise((resolve) => {
      exec("pgrep -f repair-and-restore.sh", (err, stdout) => {
        resolve(!err && String(stdout).trim().length > 0);
      });
    });
  } catch {
    return false;
  }
}

async function logTail(): Promise<string[]> {
  try {
    const raw = await fs.readFile(LOG, "utf8");
    return raw.trim().split("\n").slice(-14);
  } catch {
    return [];
  }
}

async function serverHealth(): Promise<Record<string, unknown>> {
  try {
    const r = await fetch("http://localhost:3030/health", { signal: AbortSignal.timeout(2500) });
    if (r.ok) return await r.json();
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

async function criticalFilesStatus() {
  const { exec } = await import("child_process");
  return new Promise<{ ok: boolean; output: string }>((resolve) => {
    exec(
      "bash scripts/verify-canonical.sh",
      { cwd: PROJECT, timeout: 25000 },
      (err, stdout) => {
        resolve({ ok: !err, output: String(stdout || "").trim().split("\n").slice(-3).join("\n") });
      }
    );
  });
}

/** GET — status for the /repair page (read-only diagnostics). */
export async function GET() {
  const [files, health, running, tail] = await Promise.all([
    criticalFilesStatus(),
    serverHealth(),
    repairRunning(),
    logTail(),
  ]);
  return NextResponse.json({
    serverOk: true,
    filesOk: files.ok,
    filesNote: files.output,
    models: {
      swapReady: Boolean((health as any).swap_ready),
      buffaloReady: Boolean((health as any).buffalo_ready),
      serviceUp: Boolean((health as any).ok),
    },
    repairRunning: running,
    logTail: tail,
  });
}

/** POST — kick a full repair (restore + models + rebuild + restart). Owner/admin only. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user || !(user.isOwner || user.role === "admin" || user.role === "owner")) {
    return NextResponse.json(
      { error: "هذه العملية متاحة لمالك المشروع فقط — سجّل الدخول بحساب المالك" },
      { status: 403 }
    );
  }
  if (await repairRunning()) {
    return NextResponse.json({ started: false, message: "الإصلاح جارٍ بالفعل — راقب الحالة أدناه" });
  }
  try {
    await fs.access(SCRIPT);
  } catch {
    return NextResponse.json({ error: "سكربت الإصلاح غير موجود" }, { status: 500 });
  }
  // Detached: survives this request AND this server process (the script
  // restarts the server itself at the end).
  const child = spawn("setsid", ["nohup", "bash", SCRIPT], {
    cwd: PROJECT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  child.unref();
  return NextResponse.json({
    started: true,
    message: "بدأ الإصلاح — أبقِ الصفحة مفتوحة وسيتم إعادة التشغيل تلقائياً",
  });
}
