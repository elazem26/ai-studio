"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Bot, Home, LogOut, RefreshCw, Sparkles, Crown, Activity, AlertTriangle, Users, Clock } from "lucide-react";

export default function ReportsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [activeReport, setActiveReport] = useState<any>(null);
  const [activeReportBody, setActiveReportBody] = useState<string>("");
  const [error, setError] = useState("");
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : "";
  const authHeaders: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const fetchAll = useCallback(async () => {
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    try {
      const [meRes, statsRes, reportsRes] = await Promise.all([
        fetch("/api/auth/me", { headers: authHeaders }),
        fetch("/api/admin/stats", { headers: authHeaders }),
        fetch("/api/agents/report", { headers: authHeaders }),
      ]);
      if (meRes.status === 401) { router.push("/login"); return; }
      const meData = await meRes.json(); setMe(meData);
      if (meData.role !== "admin" && meData.role !== "assistant" && !meData.isOwner) { router.push("/"); return; }
      if (statsRes.ok) setStats(await statsRes.json());
      if (reportsRes.ok) { const rd = await reportsRes.json(); setReports(rd.reports || []); }
    } catch (e: any) { setError(e?.message); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchReportBody = async (id: string) => {
    try { const r = await fetch(`/api/agents/report/${id}`, { headers: authHeaders }); const d = await r.json();
      if (r.ok) { setActiveReportBody(d.report?.body || ""); setActiveReport(d.report); }
    } catch {}
  };

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleGenerate = async () => {
    setGenerating(true); setError("");
    try { const r = await fetch("/api/agents/report", { method: "POST", headers: authHeaders, body: JSON.stringify({ type: "manual" }) });
      const d = await r.json(); if (!r.ok) { setError(d.error || "خطأ"); return; }
      await fetchAll(); if (d.report) { setActiveReportBody(d.report.body); setActiveReport(d.report); }
    } catch (e: any) { setError(e.message); }
    finally { setGenerating(false); }
  };
  const handleLogout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", headers: authHeaders }); } catch {}
    localStorage.removeItem("authToken"); router.push("/login");
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="h-8 w-8 animate-spin text-cyan-accent" /></div>;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <Card className="studio-panel border-cyan-accent/30 mb-6">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center"><FileText className="h-6 w-6 text-white" /></div>
                <div><h1 className="text-xl sm:text-2xl font-bold">التقارير والتحليلات</h1>
                  <p className="text-sm text-muted-foreground">مسجل: <span className="text-cyan-accent font-medium">{me?.name || "—"}</span>{me?.isOwner && <Badge variant="default" className="ml-2 bg-amber-500 text-black">مالك دائم</Badge>}</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={fetchAll} variant="outline" size="sm"><RefreshCw className="h-4 w-4 ml-2" />تحديث</Button>
                <Button onClick={handleGenerate} disabled={generating} className="bg-cyan-accent text-black" size="sm">{generating ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Sparkles className="h-4 w-4 ml-2" />}إنشاء تقرير بالذكاء</Button>
                <Button onClick={() => router.push("/control-panel")} variant="outline" size="sm"><Activity className="h-4 w-4 ml-2" />لوحة التحكم</Button>
                <Button onClick={() => router.push("/admin-assistant")} variant="outline" size="sm"><Bot className="h-4 w-4 ml-2" />وكيل الأوامر</Button>
                <Button onClick={() => router.push("/")} variant="outline" size="sm"><Home className="h-4 w-4 ml-2" />الرئيسية</Button>
                <Button onClick={handleLogout} variant="outline" size="sm"><LogOut className="h-4 w-4 ml-2" />خروج</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {error && <div className="mb-4 p-3 rounded-md bg-red-500/10 text-red-400 text-sm text-center">{error}</div>}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4">
            {stats && (
              <>
                <Card className="studio-panel"><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Users className="h-4 w-4 text-cyan-accent" />المستخدمون</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>الإجمالي:</span><span className="font-bold">{stats.users.total}</span></div>
                    <div className="flex justify-between"><span>نشط:</span><span className="text-emerald-500">{stats.users.verified}</span></div>
                    <div className="flex justify-between"><span>موقوف:</span><span className="text-amber-500">{stats.users.suspended}</span></div>
                    <div className="flex justify-between"><span>جدد 24h:</span><span className="text-cyan-accent">{stats.users.new24h}</span></div>
                  </CardContent>
                </Card>
                <Card className="studio-panel"><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Bot className="h-4 w-4 text-violet-500" />المساعدون</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>الإجمالي:</span><span className="font-bold">{stats.assistants.total}</span></div>
                    <div className="flex justify-between"><span>نشط:</span><span className="text-emerald-500">{stats.assistants.active}</span></div>
                  </CardContent>
                </Card>
                <Card className="studio-panel"><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Crown className="h-4 w-4 text-amber-500" />الاشتراكات</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>نشط:</span><span className="text-emerald-500">{stats.subscriptions.active}</span></div>
                    <div className="flex justify-between"><span>منتهي:</span><span className="text-red-500">{stats.subscriptions.expired}</span></div>
                    <div className="flex justify-between"><span>مدفوع:</span><span className="text-cyan-accent">{stats.subscriptions.paid}</span></div>
                  </CardContent>
                </Card>
                <Card className="studio-panel"><CardHeader><CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-sky-500" />الأداء</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex justify-between"><span>التشغيل:</span><span className="font-bold">{stats.uptime.formatted}</span></div>
                    <div className="flex justify-between"><span>ساعات الاستخدام:</span><span className="font-bold">{stats.usage.totalHours}h</span></div>
                    <div className="flex justify-between"><span>الأكثر استخداماً:</span><span className="text-cyan-accent text-xs">{stats.usage.mostUsedService}</span></div>
                    <div className="flex justify-between"><span>أخطاء 7d:</span><span className="text-red-500">{stats.logs.errors7d}</span></div>
                    <div className="flex justify-between"><span>القرص:</span><span>{stats.disk.usedGB}/{stats.disk.totalGB} GB</span></div>
                  </CardContent>
                </Card>
                {stats.usage.perService.length > 0 && (
                  <Card className="studio-panel"><CardHeader><CardTitle className="text-sm">📊 استخدام الخدمات</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      {stats.usage.perService.map((s: any, i: number) => (
                        <div key={i} className="flex justify-between"><span>{s.service}</span><span><span className="text-cyan-accent">{s.totalHours}h</span> · {s.success}✓ · {s.errors}✗</span></div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
          <div className="lg:col-span-2">
            <Card className="studio-panel min-h-[400px]">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{activeReport ? activeReport.title : "لا يوجد تقرير بعد"}</CardTitle>
                {activeReport && <Badge variant="outline" className="text-xs">{new Date(activeReport.createdAt).toLocaleString("ar-EG")}</Badge>}
              </CardHeader>
              <CardContent>
                {activeReport ? <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">{activeReportBody || activeReport.summary}</div> :
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm mb-3">لا تقارير بعد</p>
                    <Button onClick={handleGenerate} disabled={generating} className="bg-cyan-accent text-black">{generating ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Sparkles className="h-4 w-4 ml-2" />}إنشاء تقرير</Button>
                  </div>}
              </CardContent>
            </Card>
            <Card className="studio-panel mt-6">
              <CardHeader><CardTitle className="text-sm">📚 سجل التقارير ({reports.length})</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {reports.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">لا تقارير محفوظة</p> :
                  reports.map(r => (
                    <button key={r.id} onClick={() => fetchReportBody(r.id)} className={`w-full text-right p-2 rounded-md border text-xs hover:bg-cyan-accent/5 transition ${activeReport?.id === r.id ? "border-cyan-accent/50 bg-cyan-accent/5" : "border-border"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium truncate">{r.title}</span>
                        <span className="text-[10px] text-muted-foreground">{new Date(r.createdAt).toLocaleString("ar-EG")}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">{r.summary}</div>
                    </button>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
