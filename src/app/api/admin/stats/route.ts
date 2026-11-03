import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken } from "@/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUptimeMs(): Promise<number> {
  try {
    const fs = await import("fs/promises");
    const stat = await fs.stat("/home/z/my-project/extracted/dev-server.pid").catch(() => null);
    if (stat) return Date.now() - stat.mtimeMs;
  } catch {}
  return process.uptime() * 1000;
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ${sec % 60}s`;
}

export async function GET(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && admin.role !== "assistant" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;

    const totalUsers = await db.user.count();
    const verifiedUsers = await db.user.count({ where: { isVerified: true } });
    const suspendedUsers = await db.user.count({ where: { isSuspended: true } });
    const newUsers7d = await db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * dayMs) } } });
    const newUsers24h = await db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - dayMs) } } });

    const totalAssistants = await db.assistant.count();
    const activeAssistants = await db.assistant.count({ where: { status: "active" } });
    const suspendedAssistants = await db.assistant.count({ where: { status: "suspended" } });

    const totalSubs = await db.subscription.count();
    const activeSubs = await db.subscription.count({ where: { status: "active", expiresAt: { gt: now } } });
    const expiredSubs = await db.subscription.count({ where: { expiresAt: { lte: now } } });
    const trialSubs = await db.subscription.count({ where: { plan: "trial" } });
    const paidSubs = await db.subscription.count({ where: { priceUSD: { gt: 0 } } });

    const activeSessions = await db.setting.count({ where: { key: { startsWith: "session:" } } });

    const usageStats = await db.usageStat.findMany();
    const perService = new Map<string, { totalMs: number; sessions: number; success: number; errors: number }>();
    for (const u of usageStats) {
      const ex = perService.get(u.serviceKey) || { totalMs: 0, sessions: 0, success: 0, errors: 0 };
      ex.totalMs += u.totalMs; ex.sessions += u.sessionCount; ex.success += u.successCount; ex.errors += u.errorCount;
      perService.set(u.serviceKey, ex);
    }
    const perServiceArray = Array.from(perService.entries()).map(([k, v]) => ({
      service: k, totalMs: v.totalMs, totalHours: +(v.totalMs / 3600000).toFixed(2),
      sessions: v.sessions, success: v.success, errors: v.errors,
    })).sort((a, b) => b.totalMs - a.totalMs);

    const since = new Date(now.getTime() - 7 * dayMs);
    const recentLogs = await db.logEntry.findMany({ where: { createdAt: { gte: since } }, select: { level: true, category: true, message: true, details: true, createdAt: true } });
    const errors7d = recentLogs.filter(l => l.level === "error").length;
    const warns7d = recentLogs.filter(l => l.level === "warn").length;
    const recentErrors = recentLogs.filter(l => l.level === "error").slice(0, 10).map(e => ({ message: e.message, details: e.details?.slice(0, 200), category: e.category, createdAt: e.createdAt }));

    const totalCommands = await db.adminCommandLog.count();
    const commands24h = await db.adminCommandLog.count({ where: { createdAt: { gte: new Date(now.getTime() - dayMs) } } });
    const totalReports = await db.report.count();

    let diskInfo = { totalGB: 0, usedGB: 0, freeGB: 0, percent: 0 };
    try {
      const fs = await import("fs");
      const stat: any = await fs.promises.statfs("/home/z/my-project");
      const total = stat.blocks * stat.bsize;
      const free = stat.bavail * stat.bsize;
      diskInfo = { totalGB: +(total / 1e9).toFixed(1), usedGB: +((total - free) / 1e9).toFixed(1), freeGB: +(free / 1e9).toFixed(1), percent: +(((total - free) / total) * 100).toFixed(1) };
    } catch {}

    const uptimeMs = await getUptimeMs();

    return NextResponse.json({
      generatedAt: now.toISOString(),
      uptime: { ms: uptimeMs, hours: +(uptimeMs / 3600000).toFixed(2), formatted: formatDuration(uptimeMs) },
      users: { total: totalUsers, verified: verifiedUsers, suspended: suspendedUsers, new24h: newUsers24h, new7d: newUsers7d },
      assistants: { total: totalAssistants, active: activeAssistants, suspended: suspendedAssistants },
      subscriptions: { total: totalSubs, active: activeSubs, expired: expiredSubs, trial: trialSubs, paid: paidSubs },
      sessions: { activeCount: activeSessions },
      usage: { perService: perServiceArray, mostUsedService: perServiceArray[0]?.service || "none", totalHours: +(perServiceArray.reduce((s, x) => s + x.totalMs, 0) / 3600000).toFixed(2) },
      logs: { errors7d, warns7d, infos7d: recentLogs.length - errors7d - warns7d, recentErrors },
      commands: { total: totalCommands, last24h: commands24h },
      reports: { total: totalReports },
      disk: diskInfo,
    });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
