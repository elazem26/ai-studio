"use client";
import { useI18n } from "@/lib/i18n";
import { useAgentsStore } from "@/stores/agents-store";
import { useImageStore } from "@/stores/image-store";
import { useUIStore } from "@/stores/ui-store";
import { useModeStore } from "@/stores/mode-store";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Shield, Server, Lock, MessageCircle, Sparkles, Award, Activity, Play, Square, RefreshCw, AlertCircle, CheckCircle2, Database, FileCheck, Loader2, TrendingUp, Bot, User, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ICONS = { Shield, Server, Lock, MessageCircle, Sparkles, Award, Activity } as const;
type IconName = keyof typeof ICONS;
interface AgentPerformance { totalTasks: number; successCount: number; errorCount: number; totalDurationMs: number; avgTaskDurationMs: number; successRate: number; }

export function AgentsPanel() {
  const locale = useI18n((s) => s.locale);
  const agents = useAgentsStore((s) => s.agents);
  const setAgentStatus = useAgentsStore((s) => s.setAgentStatus);
  const activateAll = useAgentsStore((s) => s.activateAll);
  const stopAll = useAgentsStore((s) => s.stopAll);
  const recordAction = useAgentsStore((s) => s.recordAction);
  const recordHeartbeat = useAgentsStore((s) => s.recordHeartbeat);
  const cleanupOnClose = useAgentsStore((s) => s.cleanupOnClose);
  const setCleanupOnClose = useAgentsStore((s) => s.setCleanupOnClose);
  const { toast } = useToast();
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [performances, setPerformances] = useState<Record<string, AgentPerformance>>({});
  const [activitiesLog, setActivitiesLog] = useState<Record<string, Array<{ task: string; ok: boolean; detail: string; durationMs: number }>>>({});
  const [backups, setBackups] = useState<any[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [monitorReport, setMonitorReport] = useState<any>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);

  useEffect(() => { void loadBackups(); }, []);
  const loadBackups = async () => { try { const r = await fetch("/api/backup/list"); const d = await r.json(); setBackups(d.backups ?? []); } catch {} };
  const handleActivate = (id: string) => { setAgentStatus(id, "active"); recordHeartbeat(id); recordAction(id, "Activated"); toast({ title: `${agents[id].nameEn} activated` }); };
  const handleStop = (id: string) => { setAgentStatus(id, "stopped"); recordAction(id, "Stopped"); toast({ title: `${agents[id].nameEn} stopped` }); };
  const handleRunAgent = async (agentId: string) => {
    setRunningAgent(agentId);
    try { const r = await fetch("/api/agents/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId }) }); const d = await r.json(); if (d.ok !== undefined) { setPerformances(p => ({ ...p, [agentId]: d.metrics })); setActivitiesLog(p => ({ ...p, [agentId]: d.activities ?? [] })); recordAction(agentId, `Ran ${d.activities?.length ?? 0} tasks`); recordHeartbeat(agentId); toast({ title: `${agents[agentId].nameEn} executed`, description: `${d.metrics?.successCount ?? 0}/${d.metrics?.totalTasks ?? 0} OK` }); } } catch {} finally { setRunningAgent(null); }
  };
  const handleCreateBackup = async () => { setBackupLoading(true); try { const r = await fetch("/api/backup/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "manual", includeSource: true }) }); const d = await r.json(); if (d.ok) { toast({ title: locale === "ar" ? "تم النسخ" : "Backup created" }); await loadBackups(); } } finally { setBackupLoading(false); } };
  const handleTestBackup = async () => { setTesting(true); try { const r = await fetch("/api/backup/test", { method: "POST" }); const d = await r.json(); toast({ title: locale === "ar" ? "اكتمل الاختبار" : "Test complete", variant: d.ok ? "default" : "destructive" }); } finally { setTesting(false); } };
  const handleGenerateReport = async () => { setMonitorLoading(true); try { const r = await fetch("/api/agents/report"); const d = await r.json(); setMonitorReport(d); toast({ title: locale === "ar" ? "تم التقرير" : "Report generated" }); } finally { setMonitorLoading(false); } };

  const agentList = Object.values(agents);
  const activeCount = agentList.filter(a => a.status === "active").length;

  return (
    <div className="space-y-3">
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "حالة النظام" : "System Status"}</CardTitle>
          <Badge variant="outline" className="text-[10px] gap-1 text-emerald-400 border-emerald-400/30"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{activeCount} {locale === "ar" ? "نشط" : "active"}</Badge>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={activateAll} className="h-8 text-[11px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 ring-1 ring-emerald-400/30"><Play className="h-3.5 w-3.5" />{locale === "ar" ? "تنشيط الجميع" : "Activate All"}</Button>
          <Button size="sm" onClick={stopAll} className="h-8 text-[11px] bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-1 ring-red-400/30"><Square className="h-3.5 w-3.5" />{locale === "ar" ? "إيقاف الجميع" : "Stop All"}</Button>
          <Button size="sm" onClick={() => agentList.forEach(a => handleRunAgent(a.id))} disabled={!!runningAgent} className="h-8 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{runningAgent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}{locale === "ar" ? "اختبار الجميع" : "Test All"}</Button>
          <span className="w-px h-6 bg-border mx-1" />
          <Button size="sm" onClick={handleCreateBackup} disabled={backupLoading} className="h-8 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{backupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}{locale === "ar" ? "نسخة احتياطية" : "Backup"}</Button>
          <Button size="sm" onClick={handleTestBackup} disabled={testing} className="h-8 text-[11px]">{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck className="h-3.5 w-3.5" />}{locale === "ar" ? "اختبار" : "Test"}</Button>
          <Button size="sm" onClick={handleGenerateReport} disabled={monitorLoading} className="h-8 text-[11px]">{monitorLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}{locale === "ar" ? "تقرير" : "Report"}</Button>
          <label className="flex items-center gap-2 text-[11px] cursor-pointer"><input type="checkbox" checked={cleanupOnClose} onChange={e => setCleanupOnClose(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-accent" />{locale === "ar" ? "تنظيف عند الإغلاق" : "Cleanup on close"}</label>
        </CardContent>
      </Card>
      {monitorReport && (
        <Card className="studio-panel border-cyan-accent/30">
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "تقرير الأداء" : "Performance Report"}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2 text-xs mb-3">
              <div className="px-2 py-1.5 rounded bg-emerald-500/10 text-emerald-400 text-center"><div className="text-[9px] uppercase">{locale === "ar" ? "سليم" : "Healthy"}</div><div className="font-mono text-sm">{monitorReport.summary?.healthy ?? 0}</div></div>
              <div className="px-2 py-1.5 rounded bg-amber-500/10 text-amber-400 text-center"><div className="text-[9px] uppercase">{locale === "ar" ? "متدهور" : "Degraded"}</div><div className="font-mono text-sm">{monitorReport.summary?.degraded ?? 0}</div></div>
              <div className="px-2 py-1.5 rounded bg-red-500/10 text-red-400 text-center"><div className="text-[9px] uppercase">{locale === "ar" ? "خطأ" : "Error"}</div><div className="font-mono text-sm">{monitorReport.summary?.error ?? 0}</div></div>
              <div className="px-2 py-1.5 rounded bg-muted/30 text-muted-foreground text-center"><div className="text-[9px] uppercase">{locale === "ar" ? "غير معروف" : "Unknown"}</div><div className="font-mono text-sm">{monitorReport.summary?.unknown ?? 0}</div></div>
            </div>
            {monitorReport.recommendations?.length > 0 && <div className="space-y-1 text-[11px]">{monitorReport.recommendations.map((r: string, i: number) => <div key={i} className="px-2 py-1 rounded bg-muted/30">{r}</div>)}</div>}
          </CardContent>
        </Card>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {agentList.map((agent) => {
          const Icon = ICONS[agent.icon as IconName] ?? Sparkles;
          const isActive = agent.status === "active";
          const perf = performances[agent.id];
          const acts = activitiesLog[agent.id] ?? [];
          const isRunning = runningAgent === agent.id;
          return (
            <Card key={agent.id} className={cn("studio-panel border-panel-border relative overflow-hidden", isActive && "border-cyan-accent/40")}>
              <div className={cn("absolute top-0 left-0 right-0 h-1", isActive ? "bg-cyan-accent" : "bg-muted/30")} />
              <CardHeader className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className={cn("h-9 w-9 rounded-md flex items-center justify-center", isActive ? "bg-cyan-accent/15" : "bg-muted/40")}><Icon className="h-4 w-4" /></div>
                    <div><CardTitle className="text-xs font-semibold leading-none">{locale === "ar" ? agent.name : agent.nameEn}</CardTitle><p className="text-[9px] text-muted-foreground mt-1">{agent.tasks.filter(t => t.enabled).length}/{agent.tasks.length} {locale === "ar" ? "مهام" : "tasks"}</p></div>
                  </div>
                  <Badge variant="outline" className={cn("text-[9px] gap-1", isActive ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10" : "text-amber-400 border-amber-400/30 bg-amber-400/10")}>{isActive ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Square className="h-2.5 w-2.5" />}{isActive ? (locale === "ar" ? "نشط" : "Active") : (locale === "ar" ? "متوقف" : "Stopped")}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{locale === "ar" ? agent.description : agent.descriptionEn}</p>
                {perf && (<div className="space-y-1"><div className="flex items-center justify-between text-[9px]"><span className="text-muted-foreground">{locale === "ar" ? "معدل النجاح" : "Success rate"}</span><span className={cn("font-mono font-medium", perf.successRate >= 80 ? "text-emerald-400" : perf.successRate >= 50 ? "text-amber-400" : "text-red-400")}>{perf.successRate}%</span></div><div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden"><div className={cn("h-full rounded-full", perf.successRate >= 80 ? "bg-emerald-400" : perf.successRate >= 50 ? "bg-amber-400" : "bg-red-400")} style={{ width: `${perf.successRate}%` }} /></div></div>)}
                {acts.length > 0 && <div className="space-y-0.5 max-h-[100px] overflow-y-auto text-[9px]">{acts.map((a, i) => <div key={i} className="flex items-center gap-1.5 px-1 py-0.5 rounded bg-muted/20"><span className={a.ok ? "text-emerald-400" : "text-red-400"}>{a.ok ? "✓" : "✗"}</span><span className="text-muted-foreground truncate flex-1">{a.task}</span><span className="text-muted-foreground/60 shrink-0">{a.durationMs}ms</span></div>)}</div>}
                <div className="grid grid-cols-3 gap-1 pt-1">
                  <button onClick={() => handleActivate(agent.id)} disabled={isActive} className={cn("flex flex-col items-center justify-center gap-0.5 h-12 rounded-md text-[9px] font-medium bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-400/30", isActive && "opacity-40")}><Play className="h-3.5 w-3.5" /><span>{locale === "ar" ? "تفعيل" : "Activate"}</span></button>
                  <button onClick={() => handleStop(agent.id)} disabled={!isActive} className={cn("flex flex-col items-center justify-center gap-0.5 h-12 rounded-md text-[9px] font-medium bg-red-500/15 text-red-400 ring-1 ring-red-400/30", !isActive && "opacity-40")}><Square className="h-3.5 w-3.5" /><span>{locale === "ar" ? "إيقاف" : "Stop"}</span></button>
                  <button onClick={() => handleRunAgent(agent.id)} disabled={isRunning} className={cn("flex flex-col items-center justify-center gap-0.5 h-12 rounded-md text-[9px] font-medium bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30", isRunning && "opacity-40")}>{isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}<span>{locale === "ar" ? "تجربة" : "Test"}</span></button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {agents.chatAssistant.status === "active" && <ChatAssistant />}
    </div>
  );
}

function ChatAssistant() {
  const locale = useI18n((s) => s.locale);
  const source = useImageStore((s) => s.source);
  const garment = useImageStore((s) => s.garment);
  const activeTab = useUIStore((s) => s.activeTab);
  const mode = useModeStore((s) => s.mode);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string; timestamp: number }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, loading]);
  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg = { role: "user" as const, content: text.trim(), timestamp: Date.now() };
    setMessages((p) => [...p, userMsg]); setInput(""); setLoading(true);
    try { const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })), context: { activeTab, hasSource: !!source, hasGarment: !!garment, mode, locale } }) }); const data = await res.json(); setMessages((p) => [...p, { role: "assistant", content: data.response || "Error", timestamp: Date.now() }]); } catch { setMessages((p) => [...p, { role: "assistant", content: "Error", timestamp: Date.now() }]); } finally { setLoading(false); }
  };
  return (
    <Card className="studio-panel border-cyan-accent/30">
      <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "المساعد الذكي" : "AI Assistant"}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <div ref={scrollRef} className="max-h-[300px] overflow-y-auto rounded-md bg-black/30 p-3 space-y-2">
          {messages.length === 0 ? <div className="text-center py-6"><Bot className="h-10 w-10 text-cyan-accent/40 mx-auto mb-2" /><p className="text-xs text-muted-foreground">{locale === "ar" ? "اسألني!" : "Ask me!"}</p></div> :
            messages.map((msg, i) => (<div key={i} className={cn("flex gap-2", msg.role === "user" && "flex-row-reverse")}><div className={cn("h-6 w-6 rounded-full flex items-center justify-center shrink-0", msg.role === "user" ? "bg-cyan-accent/15" : "bg-cyan-accent/15 text-cyan-accent")}>{msg.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}</div><div className={cn("px-3 py-2 rounded-md text-xs max-w-[80%] whitespace-pre-wrap", msg.role === "user" ? "bg-cyan-accent/15 text-cyan-accent" : "bg-muted/30")}>{msg.content}</div></div>))}
          {loading && <div className="flex gap-2"><div className="h-6 w-6 rounded-full bg-cyan-accent/15 flex items-center justify-center"><Bot className="h-3 w-3 text-cyan-accent" /></div><div className="px-3 py-2 rounded-md bg-muted/30"><Loader2 className="h-3.5 w-3.5 animate-spin" /></div></div>}
        </div>
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={locale === "ar" ? "اكتب..." : "Type..."} className="h-9 text-xs flex-1 bg-black/30 border border-cyan-accent/30 rounded px-2" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }} disabled={loading} />
          <Button size="sm" onClick={() => sendMessage(input)} disabled={loading || !input.trim()} className="h-9 px-3 bg-cyan-accent text-black hover:bg-cyan-accent/90">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
