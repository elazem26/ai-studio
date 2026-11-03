import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { exec } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/proxy/health-check — فحص شامل لكل المكونات (owner request).
 *
 * Components:
 *   1. server        — this Next.js server (implicit: you got a response)
 *   2. swapService   — face-swap-pro python service (:3030) + models
 *   3. criticalFiles — the routes/hooks that broke sessions before
 *   4. build         — compiled route handlers actually exist in the bundle
 *   5. db            — prisma can read the users table
 *   6. storage       — data/uploads + data/results exist & writable
 *   7. resources     — disk free + memory available
 *   8. repairStats   — last repair date + counters (data/repair-stats.json)
 */

const PROJECT = process.cwd().includes(".next/standalone")
  ? path.resolve(process.cwd(), "..", "..")
  : process.cwd();

function run(cmd: string, timeout = 20000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd: PROJECT, timeout }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as any).code ?? 1) : 0, out: String(stdout || stderr || "") });
    });
  });
}

async function checkSwapService() {
  try {
    const r = await fetch("http://localhost:3030/health", { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ok: false, note: `HTTP ${r.status}` };
    const d: any = await r.json();
    return {
      ok: Boolean(d.buffalo_ready),
      serviceUp: true,
      buffaloReady: Boolean(d.buffalo_ready),
      swapReady: Boolean(d.swap_ready),
      note: d.swap_ready
        ? "جاهز للتبديل ✓"
        : d.model_state?.inswapper?.state === "downloading"
          ? `يحمّل النموذج ${d.model_state?.inswapper?.progress ?? 0}%`
          : "النموذج مفقود — يُحمّل تلقائياً عند أول تبديل",
    };
  } catch {
    return { ok: false, serviceUp: false, note: "الخدمة متوقفة — تُقلع تلقائياً عند أول استخدام" };
  }
}

async function checkCriticalFiles() {
  const r = await run("bash scripts/verify-canonical.sh");
  const missing = /FATAL/.test(r.out);
  return { ok: r.code === 0 && !missing, note: r.out.trim().split("\n").slice(-1)[0] ?? "" };
}

async function checkBuild() {
  const base = path.join(PROJECT, ".next", "standalone", ".next", "server", "app", "api");
  const routes = [
    "images/upload/route.js",
    "images/face-swap/route.js",
    "images/face-detect/route.js",
    "auth/login/route.js",
  ];
  const missing: string[] = [];
  for (const r of routes) {
    try {
      await fs.access(path.join(base, r));
    } catch {
      missing.push(r);
    }
  }
  return {
    ok: missing.length === 0,
    missing,
    note: missing.length ? `بناء ناقص: ${missing.join(", ")}` : "كل المسارات مترجمة ✓",
  };
}

async function checkDb() {
  try {
    const { PrismaClient } = await import("@prisma/client");
    const db = new PrismaClient();
    const n = await db.user.count();
    await db.$disconnect();
    return { ok: true, users: n, note: `قاعدة البيانات تعمل (${n} مستخدم)` };
  } catch (e: any) {
    return { ok: false, note: `خطأ قاعدة البيانات: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

async function checkStorage() {
  try {
    const up = path.join(PROJECT, "data", "uploads");
    const res = path.join(PROJECT, "data", "results");
    await fs.mkdir(up, { recursive: true });
    await fs.mkdir(res, { recursive: true });
    const probe = path.join(up, `.probe-${Date.now()}`);
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);
    return { ok: true, note: "مجلدات الرفع والنتائج سليمة وقابلة للكتابة ✓" };
  } catch (e: any) {
    return { ok: false, note: `مشكلة تخزين: ${String(e?.message ?? e).slice(0, 80)}` };
  }
}

async function checkResources() {
  const disk = await run("df --output=avail -B1 / | tail -1");
  const mem = await run("awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo");
  const diskGB = Math.round(Number(disk.out.trim() || 0) / 1024 ** 3);
  const memMB = Number(mem.out.trim() || 0);
  return {
    ok: diskGB >= 1 && memMB >= 200,
    diskGB,
    memMB,
    note: `قرص متاح ${diskGB}GB — ذاكرة متاحة ${memMB}MB`,
  };
}

async function repairStats() {
  try {
    const raw = await fs.readFile(path.join(PROJECT, "data", "repair-stats.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return { lastRepairAt: null, totalRepairs: 0, lastResult: null };
  }
}

export async function GET() {
  const [swap, files, build, db, storage, resources, stats] = await Promise.all([
    checkSwapService(),
    checkCriticalFiles(),
    checkBuild(),
    checkDb(),
    checkStorage(),
    checkResources(),
    repairStats(),
  ]);
  const components = {
    server: { ok: true, note: "السيرفر يستجيب ✓" },
    swapService: swap,
    criticalFiles: files,
    build,
    db,
    storage,
    resources,
  };
  const ok = Object.values(components).every((c: any) => c.ok);
  return NextResponse.json({ ok, ts: new Date().toISOString(), components, repairStats: stats });
}
