"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, Crown, LogOut, Calendar, DollarSign, Home } from "lucide-react";
import { PLANS } from "@/lib/auth";

export default function SubscriptionsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submittingPlan, setSubmittingPlan] = useState<string | null>(null);
  const [me, setMe] = useState<any>(null);
  const [sub, setSub] = useState<any>(null);
  const [error, setError] = useState("");
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : "";
  const authHeaders: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const fetchData = useCallback(async () => {
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    try {
      const [meRes, subRes] = await Promise.all([
        fetch("/api/auth/me", { headers: authHeaders }),
        fetch("/api/subscriptions/status", { headers: authHeaders }),
      ]);
      if (meRes.status === 401) { router.push("/login"); return; }
      const meData = await meRes.json(); setMe(meData);
      if (subRes.ok) { const sd = await subRes.json(); setSub(sd); }
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubscribe = async (planId: string) => {
    setSubmittingPlan(planId); setError("");
    try {
      const r = await fetch("/api/subscriptions/subscribe", { method: "POST", headers: authHeaders, body: JSON.stringify({ planId }) });
      const d = await r.json(); if (!r.ok) { setError(d.error || "خطأ"); return; }
      await fetchData();
    } catch (e: any) { setError(e.message); }
    finally { setSubmittingPlan(null); }
  };

  const handleLogout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", headers: authHeaders }); } catch {}
    localStorage.removeItem("authToken"); localStorage.removeItem("userName");
    router.push("/login");
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center" dir="rtl"><Loader2 className="h-8 w-8 animate-spin text-cyan-accent" /></div>;

  const currentPlanId = sub?.plan || (me?.isOwner ? "owner" : null);
  const isOwner = me?.isOwner;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6" dir="rtl">
      <div className="max-w-6xl mx-auto">
        <Card className="studio-panel border-cyan-accent/30 mb-6">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"><Crown className="h-6 w-6 text-white" /></div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold">الاشتراكات والباقات</h1>
                  <p className="text-sm text-muted-foreground">مسجل: <span className="text-cyan-accent font-medium">{me?.name || "—"}</span>{isOwner && <Badge variant="default" className="ml-2 bg-amber-500 text-black">مالك دائم</Badge>}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => router.push("/")} variant="outline"><Home className="h-4 w-4 ml-2" />الرئيسية</Button>
                <Button onClick={handleLogout} variant="outline"><LogOut className="h-4 w-4 ml-2" />خروج</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {error && <div className="mb-4 p-3 rounded-md bg-red-500/10 text-red-400 text-sm text-center">{error}</div>}
        {sub && (
          <Card className="studio-panel mb-6 border-cyan-accent/40">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  {sub.isActive ? <Badge variant="default" className="bg-emerald-500 text-white">نشط</Badge> : <Badge variant="default" className="bg-red-500 text-white">منتهي</Badge>}
                  <span className="font-medium">الباقة: {isOwner ? "مالك دائم" : (PLANS.find(p => p.id === currentPlanId)?.name || currentPlanId || "بدون")}</span>
                </div>
                {!isOwner && sub.expiresAt && <div className="flex items-center gap-1 text-sm text-muted-foreground"><Calendar className="h-4 w-4" />ينتهي: {new Date(sub.expiresAt).toLocaleDateString("ar-EG")}</div>}
                {!isOwner && sub.priceUSD > 0 && <div className="flex items-center gap-1 text-sm text-muted-foreground"><DollarSign className="h-4 w-4" />السعر: ${sub.priceUSD}</div>}
                {isOwner && <p className="text-sm text-amber-400">حسابك مالك دائم - لا يحتاج تجديد</p>}
              </div>
            </CardContent>
          </Card>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PLANS.map(plan => {
            const isCurrent = currentPlanId === plan.id;
            const price = plan.price === 0 ? "مجاناً" : `$${plan.price}`;
            const period = plan.id === "trial" ? `${plan.durationDays} أيام` : plan.id === "welcome" ? "$10/شهر × 3" : plan.id === "monthly" ? "كل شهر" : plan.id === "semiannual" ? "كل 6 أشهر" : "كل سنة";
            return (
              <Card key={plan.id} className={`studio-panel relative flex flex-col ${isCurrent ? "border-cyan-accent ring-2 ring-cyan-accent/50" : ""}`}>
                <CardContent className="pt-6 flex-1 flex flex-col">
                  <div className="mb-3">
                    <div className="text-2xl font-bold text-cyan-accent">{price}</div>
                    <div className="text-xs text-muted-foreground">{period}</div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{plan.features}</p>
                  <ul className="text-xs space-y-1 mb-4 flex-1">
                    <li className="flex items-start gap-1"><Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /><span>تبديل الملابس والستوديو</span></li>
                    <li className="flex items-start gap-1"><Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /><span>تبديل الوجه</span></li>
                    <li className="flex items-start gap-1"><Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /><span>أدوات الصور</span></li>
                    <li className="flex items-start gap-1"><Check className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /><span>محرر الفيديو الكامل</span></li>
                  </ul>
                  {isCurrent ? <Button disabled className="w-full bg-emerald-500 text-white"><Check className="h-4 w-4 ml-2" />باقتك الحالية</Button> : isOwner ? <Button disabled variant="outline" className="w-full">مالك دائم</Button> : <Button onClick={() => handleSubscribe(plan.id)} disabled={submittingPlan === plan.id} className="w-full bg-cyan-accent text-black">{submittingPlan === plan.id && <Loader2 className="h-4 w-4 animate-spin ml-2" />}{plan.price === 0 ? "ابدأ التجربة" : "اشترك الآن"}</Button>}
                </CardContent>
              </Card>
            );
          })}
        </div>
        {(me?.role === "admin" || me?.isOwner) && (
          <Card className="studio-panel mt-6 border-amber-500/30">
            <CardContent className="p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div><h2 className="text-lg font-bold flex items-center gap-2"><Crown className="h-5 w-5 text-amber-500" />أدوات الإدارة</h2><p className="text-sm text-muted-foreground">إدارة المساعدين والصلاحيات</p></div>
                <Button onClick={() => router.push("/assistants")} className="bg-amber-500 text-black">إدارة المساعدين</Button>
              </div>
            </CardContent>
          </Card>
        )}
        <div className="mt-6 p-4 rounded-md bg-amber-500/10 text-amber-400 text-xs text-center">ملاحظة: في الوضع التجريبي، يتم تفعيل الاشتراك فوراً عند الضغط على "اشترك".</div>
      </div>
    </div>
  );
}
