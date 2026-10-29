"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Loader2, Plus, MoreVertical, Pause, Play, Pencil, Trash2, Users, LogOut, Home } from "lucide-react";
import { PERMISSION_KEYS } from "@/lib/auth";

interface AssistantPermission { key: string; value: boolean; }
interface Assistant {
  id: string; name: string; status: string; expiresAt: string | null;
  email: string | null; phone: string | null; permissions: AssistantPermission[]; createdAt: string;
}
const ALL_PERMS = PERMISSION_KEYS.filter(p => p.key !== "admin");

export default function AssistantsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState(""); const [formEmail, setFormEmail] = useState("");
  const [formPhone, setFormPhone] = useState(""); const [formPassword, setFormPassword] = useState("");
  const [formPerms, setFormPerms] = useState<Record<string, boolean>>({});
  const [formExpiresAt, setFormExpiresAt] = useState(""); const [submitting, setSubmitting] = useState(false);

  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : "";
  const authHeaders: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const fetchAll = useCallback(async () => {
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    try {
      const [meRes, listRes] = await Promise.all([
        fetch("/api/auth/me", { headers: authHeaders }),
        fetch("/api/assistants", { headers: authHeaders }),
      ]);
      if (meRes.status === 401) { router.push("/login"); return; }
      const meData = await meRes.json();
      setMe(meData);
      if (meData.role !== "admin" && meData.role !== "assistant" && !meData.isOwner) { router.push("/"); return; }
      const listData = await listRes.json();
      setAssistants(listData.assistants || []);
    } catch (e: any) { setError(e?.message || "خطأ"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => { setFormName(""); setFormEmail(""); setFormPhone(""); setFormPassword(""); setFormPerms({}); setFormExpiresAt(""); setEditingId(null); };
  const openCreate = () => { resetForm(); const d: Record<string, boolean> = {}; ALL_PERMS.forEach(p => { d[p.key] = true; }); setFormPerms(d); setShowCreate(true); };
  const openEdit = (a: Assistant) => {
    setFormName(a.name); setFormEmail(a.email || ""); setFormPhone(a.phone || ""); setFormPassword("");
    const perms: Record<string, boolean> = {};
    ALL_PERMS.forEach(p => { const f = a.permissions.find(x => x.key === p.key); perms[p.key] = f ? f.value : false; });
    setFormPerms(perms); setFormExpiresAt(a.expiresAt ? a.expiresAt.split("T")[0] : ""); setEditingId(a.id); setShowCreate(true);
  };

  const handleSubmit = async () => {
    if (!formName || !formPassword) { setError("الاسم وكلمة المرور مطلوبان"); return; }
    setSubmitting(true); setError("");
    try {
      const permKeys = Object.keys(formPerms).filter(k => formPerms[k]);
      const body: any = { name: formName, email: formEmail || undefined, phone: formPhone || undefined, password: formPassword, permissions: permKeys, expiresAt: formExpiresAt ? new Date(formExpiresAt).toISOString() : null };
      const r = editingId
        ? await fetch(`/api/assistants/${editingId}`, { method: "PUT", headers: authHeaders, body: JSON.stringify(body) })
        : await fetch("/api/assistants", { method: "POST", headers: authHeaders, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      setShowCreate(false); resetForm(); await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  const handleToggleStatus = async (a: Assistant, newStatus: string) => {
    try {
      const r = await fetch(`/api/assistants/${a.id}`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ status: newStatus, permissions: a.permissions.filter(p => p.value).map(p => p.key) }) });
      const d = await r.json(); if (!r.ok) { setError(d.error || "خطأ"); return; }
      await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  const handleDelete = async (a: Assistant) => {
    if (!confirm(`حذف المساعد "${a.name}"؟`)) return;
    try {
      const r = await fetch(`/api/assistants/${a.id}`, { method: "DELETE", headers: authHeaders });
      const d = await r.json(); if (!r.ok) { setError(d.error || "خطأ"); return; }
      await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  const handleLogout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", headers: authHeaders }); } catch {}
    localStorage.removeItem("authToken"); localStorage.removeItem("userName");
    router.push("/login");
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="h-8 w-8 animate-spin text-cyan-accent" /></div>;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <Card className="studio-panel border-cyan-accent/30 mb-6">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
                  <Users className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold">إدارة المساعدين</h1>
                  <p className="text-sm text-muted-foreground">مسجل: <span className="text-cyan-accent font-medium">{me?.name || "—"}</span>{me?.isOwner && <Badge variant="default" className="ml-2 bg-amber-500 text-black">مالك دائم</Badge>}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {me?.role === "admin" || me?.isOwner ? (
                  <Button onClick={openCreate} className="bg-cyan-accent text-black"><Plus className="h-4 w-4 ml-2" />إضافة مساعد</Button>
                ) : null}
                <Button onClick={() => router.push("/")} variant="outline"><Home className="h-4 w-4 ml-2" />الرئيسية</Button>
                <Button onClick={handleLogout} variant="outline"><LogOut className="h-4 w-4 ml-2" />خروج</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {error && <div className="mb-4 p-3 rounded-md bg-red-500/10 text-red-400 text-sm text-center">{error}</div>}
        {assistants.length === 0 ? (
          <Card className="studio-panel"><CardContent className="p-12 text-center text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg mb-2">لا يوجد مساعدون بعد</p>
            <p className="text-sm mb-4">أنشئ أول مساعد للوصول المحدود</p>
            {(me?.role === "admin" || me?.isOwner) && <Button onClick={openCreate} className="bg-cyan-accent text-black"><Plus className="h-4 w-4 ml-2" />إضافة مساعد</Button>}
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assistants.map(a => (
              <Card key={a.id} className="studio-panel">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2">
                        {a.name}
                        {a.status === "active" ? <Badge variant="default" className="bg-emerald-500 text-white">نشط</Badge> : a.status === "suspended" ? <Badge variant="default" className="bg-amber-500 text-black">موقوف</Badge> : <Badge variant="default" className="bg-red-500 text-white">منتهي</Badge>}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">{a.email || a.phone || "بدون بريد/هاتف"}</p>
                    </div>
                    {(me?.role === "admin" || me?.isOwner) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(a)}><Pencil className="h-4 w-4 ml-2" />تعديل</DropdownMenuItem>
                          {a.status === "active" ? <DropdownMenuItem onClick={() => handleToggleStatus(a, "suspended")}><Pause className="h-4 w-4 ml-2" />إيقاف مؤقت</DropdownMenuItem> : <DropdownMenuItem onClick={() => handleToggleStatus(a, "active")}><Play className="h-4 w-4 ml-2" />تفعيل</DropdownMenuItem>}
                          <DropdownMenuItem onClick={() => handleDelete(a)} className="text-red-400"><Trash2 className="h-4 w-4 ml-2" />حذف</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  <div className="text-xs text-muted-foreground">ينتهي في: {a.expiresAt ? new Date(a.expiresAt).toLocaleDateString("ar-EG") : "بدون تاريخ انتهاء"}</div>
                  <div className="flex flex-wrap gap-1">
                    {a.permissions.filter(p => p.value).map(p => { const meta = PERMISSION_KEYS.find(k => k.key === p.key); return <Badge key={p.key} variant="outline" className="text-[10px] py-0">{meta?.label || p.key}</Badge>; })}
                    {a.permissions.filter(p => p.value).length === 0 && <span className="text-xs text-muted-foreground">لا صلاحيات</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetForm(); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader><DialogTitle>{editingId ? "تعديل المساعد" : "إضافة مساعد جديد"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5"><Label>الاسم *</Label><Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="اسم المساعد" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>البريد</Label><Input value={formEmail} onChange={e => setFormEmail(e.target.value)} placeholder="email@x.com" /></div>
                <div className="space-y-1.5"><Label>الهاتف</Label><Input value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="05xxxxxxxx" /></div>
              </div>
              <div className="space-y-1.5"><Label>كلمة المرور *</Label><Input type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)} placeholder="••••••" /></div>
              <div className="space-y-1.5"><Label>تاريخ الانتهاء</Label><Input type="date" value={formExpiresAt} onChange={e => setFormExpiresAt(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>الصلاحيات</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 rounded-md border border-border">
                  {ALL_PERMS.map(p => (
                    <label key={p.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={formPerms[p.key] || false} onCheckedChange={(v) => setFormPerms(prev => ({ ...prev, [p.key]: !!v }))} />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>إلغاء</Button>
              <Button onClick={handleSubmit} disabled={submitting} className="bg-cyan-accent text-black">{submitting && <Loader2 className="h-4 w-4 animate-spin ml-2" />}{editingId ? "حفظ التعديلات" : "إنشاء المساعد"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
