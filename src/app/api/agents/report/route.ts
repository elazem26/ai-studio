import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken, PLANS, PERMISSION_KEYS } from "@/lib/auth";
import { callLLM, type LLMMessage } from "@/lib/ai/free-llm";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function buildSnapshot() {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  const totalUsers = await db.user.count();
  const verifiedUsers = await db.user.count({ where: { isVerified: true } });
  const suspendedUsers = await db.user.count({ where: { isSuspended: true } });
  const newUsers24h = await db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - dayMs) } } });
  const newUsers7d = await db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * dayMs) } } });

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
  const errors7d = recentLogs.filter(l => l.level === "error");
  const warns7d = recentLogs.filter(l => l.level === "warn").length;
  const recentErrors = errors7d.slice(0, 10).map(e => ({ message: e.message, details: e.details?.slice(0, 200), category: e.category, createdAt: e.createdAt }));

  const totalCommands = await db.adminCommandLog.count();
  const commands24h = await db.adminCommandLog.count({ where: { createdAt: { gte: new Date(now.getTime() - dayMs) } } });

  let diskInfo = { totalGB: 0, usedGB: 0, freeGB: 0, percent: 0 };
  try {
    const fs = await import("fs");
    const stat: any = await fs.promises.statfs("/home/z/my-project");
    const total = stat.blocks * stat.bsize; const free = stat.bavail * stat.bsize;
    diskInfo = { totalGB: +(total / 1e9).toFixed(1), usedGB: +((total - free) / 1e9).toFixed(1), freeGB: +(free / 1e9).toFixed(1), percent: +(((total - free) / total) * 100).toFixed(1) };
  } catch {}

  let uptimeMs = process.uptime() * 1000;
  try {
    const fs = await import("fs/promises");
    const st = await fs.stat("/home/z/my-project/extracted/dev-server.pid").catch(() => null);
    if (st) uptimeMs = Date.now() - st.mtimeMs;
  } catch {}

  return {
    generatedAt: now.toISOString(),
    uptime: { ms: uptimeMs, hours: +(uptimeMs / 3600000).toFixed(2) },
    users: { total: totalUsers, verified: verifiedUsers, suspended: suspendedUsers, new24h: newUsers24h, new7d: newUsers7d },
    assistants: { total: totalAssistants, active: activeAssistants, suspended: suspendedAssistants },
    subscriptions: { total: totalSubs, active: activeSubs, expired: expiredSubs, trial: trialSubs, paid: paidSubs },
    sessions: { activeCount: activeSessions },
    usage: { perService: perServiceArray, mostUsedService: perServiceArray[0]?.service || "none", totalHours: +(perServiceArray.reduce((s, x) => s + x.totalMs, 0) / 3600000).toFixed(2) },
    logs: { errors7d: errors7d.length, warns7d, recentErrors },
    commands: { total: totalCommands, last24h: commands24h },
    reports: { total: await db.report.count() },
    disk: diskInfo,
  };
}

async function generateReport(snap: any): Promise<{ title: string; summary: string; body: string }> {
  const factsBlob = JSON.stringify(snap, null, 2);
  const systemPrompt = `أنت وكيل ذكاء اصطناعي يقدم تقارير دورية لمدير مشروع "AI Clothing Studio". قدم تقريراً شاملاً بالعربية (Markdown) يحتوي على: ملخص تنفيذي، إحصائيات المستخدمين والمساعدين، الاشتراكات، الأداء والاستخدام لكل خدمة، المشاكل والحلول، سجل الأوامر، حالة القرص، والتوصيات. استخدم البيانات الفعلية.`;
  try {
    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `إليك الإحصائيات:\n\n\`\`\`json\n${factsBlob}\n\`\`\n\nاكتب التقرير الكامل الآن.` },
    ];
    const response = await callLLM(messages, { preferProvider: "groq", maxTokens: 4000 });
    const body = response.text || "";
    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : `تقرير ${new Date().toLocaleString("ar-EG")}`;
    const summaryMatch = body.match(/الملخص التنفيذي\s*\n+([^\n]+)/);
    const summary = summaryMatch ? summaryMatch[1] : "تم إنشاء التقرير";
    return { title, summary, body };
  } catch {
    const title = `تقرير آلي — ${new Date().toLocaleString("ar-EG")}`;
    const summary = `مستخدمين: ${snap.users.total}، مساعدين: ${snap.assistants.total}، أخطاء 7 أيام: ${snap.logs.errors7d}`;
    const body = `# ${title}\n\n## الملخص التنفيذي\n${summary}\n\n## المستخدمون\n- الإجمالي: ${snap.users.total}\n\n## الاشتراكات\n- نشط: ${snap.subscriptions.active}\n\n## الاستخدام\n- إجمالي ساعات: ${snap.usage.totalHours}\n- الأكثر استخداماً: ${snap.usage.mostUsedService}`;
    return { title, summary, body };
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const user = await db.user.findUnique({ where: { id: session.value } });
    if (!user || (user.role !== "admin" && user.role !== "assistant" && !user.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });
    const reports = await db.report.findMany({
      orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, type: true, title: true, summary: true, createdAt: true },
    });
    return NextResponse.json({ reports, total: reports.length });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const user = await db.user.findUnique({ where: { id: session.value } });
    if (!user || (user.role !== "admin" && user.role !== "assistant" && !user.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as { type?: string };
    const type = body.type || "manual";
    const snap = await buildSnapshot();
    const { title, summary, body: reportBody } = await generateReport(snap);
    const report = await db.report.create({ data: { type, title, summary, body: reportBody, metricsJson: JSON.stringify(snap) } });
    return NextResponse.json({ ok: true, report: { id: report.id, type: report.type, title: report.title, summary: report.summary, body: report.body, createdAt: report.createdAt }, metrics: snap });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
