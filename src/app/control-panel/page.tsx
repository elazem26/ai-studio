"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2, Shield, Crown, Users, Activity, Database, LogOut, Home, RefreshCw, Pause, Play, Trash2, MoreVertical, Save, FileText, Bot, AlertTriangle, Key } from "lucide-react";

interface Stats {
  generatedAt: string; uptime: { hours: number; formatted: string };
  users: { total: number; verified: number; suspended: number; new24h: number; new7d: number };
  assistants: { total: number; active: number; suspended: number };
  subscriptions: { total: number; active: number; expired: number; trial: number; paid: number };
  sessions: { activeCount: number };
  usage: { perService: any[]; mostUsedService: string; totalHours: number };
  logs: { errors7d: number; warns7d: number; infos7d: number; recentErrors: any[] };
  commands: { total: number; last24h: number };
  reports: { total: number };
  disk: { totalGB: number; usedGB: number; freeGB: number; percent: number };
}
interface UserRow { id: string; name: string | null; email: string | null; phone: string | null; role: string; isOwner: boolean; isSuspended: boolean; isVerified: boolean; createdAt: string; }

export default function ControlPanelPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : "";
  const authHeaders: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const fetchAll = useCallback(async () => {
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    try {
      const [meRes, statsRes, usersRes] = await Promise.all([
        fetch("/api/auth/me", { headers: authHeaders }),
        fetch("/api/admin/stats", { headers: authHeaders }),
        fetch("/api/admin/users", { headers: authHeaders }),
      ]);
      if (meRes.status === 401) { router.push("/login"); return; }
      const meData = await meRes.json(); setMe(meData);
      if (meData.role !== "admin" && meData.role !== "assistant" && !meData.isOwner) { router.push("/"); return; }
      if (statsRes.ok) setStats(await statsRes.json());
      if (usersRes.ok) { const ud = await usersRes.json(); setUsers(ud.users || []); }
    } catch (e: any) { setError(e?.message || "خطأ"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSuspendUser = async (u: UserRow, suspend: boolean) => {
    setBusy(u.id);
    try { const r = await fetch(`/api/admin/users/${u.id}`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ isSuspended: suspend }) });
      const d = await r.json(); if (!r.ok) { setError(d.error || "خطأ"); return; } await fetchAll();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const handleDeleteUser = async (u: UserRow) => {
    if (!confirm(`حذف المستخدم "${u.name || u.email || u.id}"؟`)) return;
    setBusy(u.id);
    try { const r = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE", headers: authHeaders });
      const d = await r.json(); if (!r.ok) { setError(d.error || "خطأ"); return; } await fetchAll();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };
  const handleBackup = async () => {
    setBusy("backup");
    try { const r = await fetch("/api/system/full-backup", { method: "POST" }); const d = await r.json();
      if (d.ok) alert(`✅ تم إنشاء نسخة في ${d.savedCount} مواقع`); else alert("فشل");
    } catch { alert("خطأ"); } finally { setBusy(null); }
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
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center"><Shield className="h-6 w-6 text-white" /></div>
                <div><h1 className="text-xl sm:text-2xl font-bold">لوحة التحكم الشاملة</h1>
                  <p className="text-sm text-muted-foreground">مسجل: <span className="text-cyan-accent font-medium">{me?.name || "—"}</span>{me?.isOwner && <Badge variant="default" className="ml-2 bg-amber-500 text-black">مالك دائم</Badge>}</p></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={fetchAll} variant="outline" size="sm"><RefreshCw className="h-4 w-4 ml-2" />تحديث</Button>
                {(me?.role === "admin" || me?.isOwner) && <Button onClick={handleBackup} variant="outline" size="sm" disabled={busy === "backup"}>{busy === "backup" ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <Save className="h-4 w-4 ml-2" />}نسخة احتياطية</Button>}
                <Button onClick={() => router.push("/reports")} variant="outline" size="sm"><FileText className="h-4 w-4 ml-2" />التقارير</Button>
                <Button onClick={() => router.push("/admin-assistant")} variant="outline" size="sm"><Bot className="h-4 w-4 ml-2" />وكيل الأوامر</Button>
                <Button onClick={() => router.push("/llm-keys")} variant="outline" size="sm"><Key className="h-4 w-4 ml-2" />مفاتيح المزودين</Button>
                <Button onClick={() => router.push("/assistants")} variant="outline" size="sm"><Users className="h-4 w-4 ml-2" />المساعدون</Button>
                <Button onClick={() => router.push("/")} variant="outline" size="sm"><Home className="h-4 w-4 ml-2" />الرئيسية</Button>
                <Button onClick={handleLogout} variant="outline" size="sm"><LogOut className="h-4 w-4 ml-2" />خروج</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {error && <div className="mb-4 p-3 rounded-md bg-red-500/10 text-red-400 text-sm text-center">{error}</div>}
        {stats && (
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 mb-6">
            <StatCard title="المستخدمون" value={stats.users.total} subtitle={`نشط: ${stats.users.verified} | موقوف: ${stats.users.suspended}`} icon={<Users className="h-5 w-5" />} color="from-blue-500 to-cyan-500" />
            <StatCard title="المساعدون" value={stats.assistants.total} subtitle={`نشط: ${stats.assistants.active} | موقوف: ${stats.assistants.suspended}`} icon={<Bot className="h-5 w-5" />} color="from-violet-500 to-fuchsia-500" />
            <StatCard title="اشتراكات نشطة" value={stats.subscriptions.active} subtitle={`منتهي: ${stats.subscriptions.expired} | مدفوع: ${stats.subscriptions.paid}`} icon={<Crown className="h-5 w-5" />} color="from-amber-500 to-orange-500" />
            <StatCard title="جلسات نشطة" value={stats.sessions.activeCount} subtitle="رموز مسجلة" icon={<Activity className="h-5 w-5" />} color="from-emerald-500 to-teal-500" />
            <StatCard title="وقت التشغيل" value={`${stats.uptime.hours}h`} subtitle={stats.uptime.formatted} icon={<RefreshCw className="h-5 w-5" />} color="from-sky-500 to-blue-500" />
            <StatCard title="ساعات الاستخدام" value={stats.usage.totalHours} subtitle={`الأكثر: ${stats.usage.mostUsedService}`} icon={<Activity className="h-5 w-5" />} color="from-purple-500 to-pink-500" />
            <StatCard title="أخطاء 7 أيام" value={stats.logs.errors7d} subtitle={`تحذيرات: ${stats.logs.warns7d}`} icon={<AlertTriangle className="h-5 w-5" />} color="from-red-500 to-rose-500" />
            <StatCard title="القرص المستخدم" value={`${stats.disk.percent}%`} subtitle={`${stats.disk.usedGB} / ${stats.disk.totalGB} GB`} icon={<Database className="h-5 w-5" />} color="from-slate-500 to-zinc-500" />
          </div>
        )}
        {stats && stats.usage.perService.length > 0 && (
          <Card className="studio-panel mb-6"><CardHeader><CardTitle className="text-base">📊 استخدام الخدمات</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>الخدمة</TableHead><TableHead>الساعات</TableHead><TableHead>الجلسات</TableHead><TableHead>نجاح</TableHead><TableHead>أخطاء</TableHead></TableRow></TableHeader>
                <TableBody>
                  {stats.usage.perService.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{s.service}</TableCell>
                      <TableCell>{s.totalHours}</TableCell>
                      <TableCell>{s.sessions}</TableCell>
                      <TableCell className="text-emerald-500">{s.success}</TableCell>
                      <TableCell className="text-red-500">{s.errors}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {stats && stats.logs.recentErrors.length > 0 && (
          <Card className="studio-panel mb-6 border-red-500/20">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-red-500" />أحدث الأخطاء</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {stats.logs.recentErrors.map((e, i) => (
                <div key={i} className="p-2 rounded-md bg-red-500/5 border border-red-500/20 text-xs">
                  <div className="font-mono text-red-400">[{e.category}] {new Date(e.createdAt).toLocaleString("ar-EG")}</div>
                  <div className="text-foreground">{e.message}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {(me?.role === "admin" || me?.isOwner) && (
          <Card className="studio-panel">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="h-4 w-4" />إدارة المستخدمين ({users.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>البريد/الهاتف</TableHead><TableHead>الدور</TableHead><TableHead>الحالة</TableHead><TableHead>تاريخ</TableHead><TableHead className="text-left">إجراءات</TableHead></TableRow></TableHeader>
                <TableBody>
                  {users.map(u => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name || "—"}{u.isOwner && <Badge variant="default" className="ml-2 bg-amber-500 text-black text-[10px]">★</Badge>}</TableCell>
                      <TableCell className="text-xs">{u.email || u.phone || "—"}</TableCell>
                      <TableCell className="text-xs"><Badge variant="outline">{u.role}</Badge></TableCell>
                      <TableCell>{u.isSuspended ? <Badge variant="default" className="bg-amber-500 text-black text-[10px]">موقوف</Badge> : u.isVerified ? <Badge variant="default" className="bg-emerald-500 text-white text-[10px]">نشط</Badge> : <Badge variant="default" className="bg-slate-500 text-white text-[10px]">غير مؤكد</Badge>}</TableCell>
                      <TableCell className="text-xs">{new Date(u.createdAt).toLocaleDateString("ar-EG")}</TableCell>
                      <TableCell>
                        {u.isOwner ? <span className="text-xs text-muted-foreground">المالك</span> : (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy === u.id}>{busy === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <MoreVertical className="h-3 w-3" />}</Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {u.isSuspended ? <DropdownMenuItem onClick={() => handleSuspendUser(u, false)}><Play className="h-3 w-3 ml-2" />تفعيل</DropdownMenuItem> : <DropdownMenuItem onClick={() => handleSuspendUser(u, true)}><Pause className="h-3 w-3 ml-2" />إيقاف</DropdownMenuItem>}
                              <DropdownMenuItem onClick={() => handleDeleteUser(u)} className="text-red-400"><Trash2 className="h-3 w-3 ml-2" />حذف</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">لا يوجد مستخدمون</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({ title, value, subtitle, icon, color }: { title: string; value: any; subtitle: string; icon: any; color: string }) {
  return (
    <Card className="studio-panel"><CardContent className="p-4">
      <div className="flex items-start justify-between mb-2"><div className={`h-9 w-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white`}>{icon}</div></div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-[10px] text-muted-foreground mt-1">{subtitle}</div>
    </CardContent></Card>
  );
}
