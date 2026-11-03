import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionToken, hashPassword } from "@/lib/auth";
import { callLLM, type LLMMessage } from "@/lib/ai/free-llm";
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
    const commands = await db.adminCommandLog.findMany({
      orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, rawCommand: true, action: true, result: true, success: true, createdAt: true },
    });
    return NextResponse.json({ commands });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

interface ParsedCommand { action: string; params: Record<string, any>; confidence: number; }

async function parseCommandWithLLM(rawCommand: string): Promise<ParsedCommand> {
  const systemPrompt = `أنت محلل أوامر إدارية لمشروع "AI Clothing Studio". تحويل أوامر المدير الطبيعية إلى JSON.

الأوامر: send_message, suspend_user, activate_user, delete_user, create_assistant, suspend_assistant, activate_assistant, delete_assistant, restart_service, backup_now, generate_report, list_users, list_assistants, system_status, clear_logs, extend_subscription.

أمثلة:
- "اعرض قائمة المستخدمين" → {"action":"list_users","params":{},"confidence":0.95}
- "أنشئ نسخة احتياطية" → {"action":"backup_now","params":{"location":"all"},"confidence":0.95}
- "حالة النظام" → {"action":"system_status","params":{},"confidence":0.95}
- "اعرض قائمة المساعدين" → {"action":"list_assistants","params":{},"confidence":0.95}
- "أنشئ تقرير يومي" → {"action":"generate_report","params":{"type":"daily"},"confidence":0.95}

الإخراج: JSON صالح فقط بدون markdown fences.`;
  try {
    const messages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `الأمر: "${rawCommand}"` },
    ];
    const response = await callLLM(messages, { preferProvider: "groq" });
    const raw = response.text || "";
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean);
    return { action: parsed.action, params: parsed.params || {}, confidence: parsed.confidence ?? 0.5 };
  } catch {
    const cmd = rawCommand.toLowerCase();
    if (cmd.includes("نسخة") || cmd.includes("backup") || cmd.includes("احتياطية")) return { action: "backup_now", params: { location: "all" }, confidence: 0.6 };
    if (cmd.includes("تقرير") || cmd.includes("report")) return { action: "generate_report", params: { type: "manual" }, confidence: 0.6 };
    if (cmd.includes("تبديل الوجه") || cmd.includes("face-swap")) return { action: "restart_service", params: { service: "face-swap" }, confidence: 0.6 };
    if (cmd.includes("مستخدمين") || cmd.includes("users")) return { action: "list_users", params: {}, confidence: 0.6 };
    if (cmd.includes("مساعدين") || cmd.includes("assistants")) return { action: "list_assistants", params: {}, confidence: 0.6 };
    if (cmd.includes("حالة") || cmd.includes("status")) return { action: "system_status", params: {}, confidence: 0.6 };
    return { action: "unknown", params: {}, confidence: 0 };
  }
}

async function executeAction(parsed: ParsedCommand, adminId: string): Promise<{ success: boolean; message: string; reply: string }> {
  const { action, params } = parsed;
  try {
    switch (action) {
      case "list_users": {
        const users = await db.user.findMany({
          select: { id: true, name: true, email: true, phone: true, role: true, isOwner: true, isSuspended: true, createdAt: true },
          orderBy: { createdAt: "desc" }, take: 20,
        });
        const lines = users.map(u => `• ${u.name || "بدون اسم"} — ${u.email || u.phone || "?"} (${u.role}${u.isOwner ? " ★" : ""}${u.isSuspended ? " موقوف" : ""})`).join("\n");
        return { success: true, message: `عرض ${users.length} مستخدم`, reply: `📋 قائمة المستخدمين (${users.length}):\n\n${lines}` };
      }
      case "list_assistants": {
        const asst = await db.assistant.findMany({
          include: { user: { select: { id: true, name: true, email: true, phone: true, role: true, isOwner: true, isSuspended: true, createdAt: true } } },
          orderBy: { createdAt: "desc" }, take: 20,
        });
        const lines = asst.map(a => `• ${a.name} — ${a.user.email || a.user.phone || "?"} (${a.status})`).join("\n");
        return { success: true, message: `عرض ${asst.length} مساعد`, reply: `👥 قائمة المساعدين (${asst.length}):\n\n${lines || "لا يوجد"}` };
      }
      case "system_status": {
        const users = await db.user.count();
        const assistants = await db.assistant.count();
        const subs = await db.subscription.count({ where: { status: "active" } });
        return { success: true, message: "جمعت الإحصائيات", reply: `📊 حالة النظام:\n• المستخدمين: ${users}\n• المساعدين: ${assistants}\n• اشتراكات نشطة: ${subs}\n• وقت التشغيل: ${Math.floor(process.uptime() / 60)} دقيقة` };
      }
      case "backup_now": {
        const base = `http://localhost:${process.env.PORT || 3000}`;
        const r = await fetch(`${base}/api/system/full-backup`, { method: "POST" });
        const d = await r.json();
        if (d.ok) return { success: true, message: `تم إنشاء نسخة في ${d.savedCount} مواقع`, reply: `💾 ✅ تم إنشاء نسخة احتياطية بنجاح في ${d.savedCount} مواقع` };
        return { success: false, message: "فشل النسخ", reply: "❌ فشل إنشاء النسخة الاحتياطية" };
      }
      case "generate_report": {
        const base = `http://localhost:${process.env.PORT || 3000}`;
        const r = await fetch(`${base}/api/agents/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: params.type || "manual" }) });
        const d = await r.json();
        if (d.ok) return { success: true, message: "تم إنشاء التقرير", reply: `📊 ✅ تم إنشاء التقرير: ${d.report.title}\n\n${d.report.summary}` };
        return { success: false, message: "فشل إنشاء التقرير", reply: "❌ فشل إنشاء التقرير" };
      }
      case "create_assistant": {
        if (!params.name || !params.password) return { success: false, message: "اسم وكلمة مرور مطلوبان", reply: "❌ اسم وكلمة مرور المساعد مطلوبان" };
        const user = await db.user.create({ data: { name: params.name, email: params.email || null, phone: params.phone || null, passwordHash: hashPassword(params.password), role: "assistant", isVerified: true } });
        await db.assistant.create({ data: { userId: user.id, managedBy: adminId, name: params.name, status: "active" } });
        return { success: true, message: `تم إنشاء المساعد ${params.name}`, reply: `✅ تم إنشاء المساعد "${params.name}" بنجاح` };
      }
      case "send_message": {
        const msgKey = `notify:${params.target || "user"}:${params.targetId || "all"}:${Date.now()}`;
        await db.setting.create({ data: { key: msgKey, value: params.message || "" } });
        return { success: true, message: "تم تسجيل الرسالة", reply: `📨 ✅ تم تسجيل الرسالة للإرسال` };
      }
      case "clear_logs": {
        const days = params.olderThanDays || 30;
        const result = await db.logEntry.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400000) } } });
        return { success: true, message: `تم حذف ${result.count} سجل`, reply: `🗑️ ✅ تم حذف ${result.count} سجل أقدم من ${days} يوم` };
      }
      case "suspend_user": {
        if (!params.userId) return { success: false, message: "userId مطلوب", reply: "❌ معرّف المستخدم مطلوب" };
        await db.user.update({ where: { id: params.userId }, data: { isSuspended: true } });
        return { success: true, message: "تم الإيقاف", reply: `🚫 تم إيقاف المستخدم` };
      }
      case "activate_user": {
        if (!params.userId) return { success: false, message: "userId مطلوب", reply: "❌ معرّف المستخدم مطلوب" };
        await db.user.update({ where: { id: params.userId }, data: { isSuspended: false } });
        return { success: true, message: "تم التفعيل", reply: `✅ تم تفعيل المستخدم` };
      }
      default: return { success: false, message: "أمر غير مفهوم", reply: `❌ لم أتمكن من فهم الأمر. جرّب: قائمة المستخدمين، نسخة احتياطية، حالة النظام، إنشاء تقرير...` };
    }
  } catch (e: any) { return { success: false, message: e?.message, reply: `❌ خطأ: ${e?.message || "غير معروف"}` }; }
}

export async function POST(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "غير مسجل" }, { status: 401 });
    const session = await db.setting.findUnique({ where: { key: `session:${token}` } });
    if (!session) return NextResponse.json({ error: "جلسة منتهية" }, { status: 401 });
    const admin = await db.user.findUnique({ where: { id: session.value } });
    if (!admin || (admin.role !== "admin" && admin.role !== "assistant" && !admin.isOwner))
      return NextResponse.json({ error: "صلاحيات غير كافية" }, { status: 403 });

    const { command } = (await req.json().catch(() => ({}))) as { command?: string };
    if (!command || !command.trim()) return NextResponse.json({ error: "الأمر مطلوب" }, { status: 400 });

    const parseResult = await parseCommandWithLLM(command.trim());
    if (!parseResult) return NextResponse.json({ error: "تعذر تحليل الأمر" }, { status: 500 });
    const execResult = await executeAction(parseResult, admin.id);

    const logEntry = await db.adminCommandLog.create({
      data: { adminId: admin.id, rawCommand: command, parsedJson: JSON.stringify(parseResult), action: parseResult.action || "unknown", result: execResult.message, success: execResult.success },
    });

    return NextResponse.json({ ok: execResult.success, parsed: parseResult, execution: execResult, logId: logEntry.id, reply: execResult.reply });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}
