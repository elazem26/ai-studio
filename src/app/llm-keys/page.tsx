"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Key, FlaskConical, RotateCcw, Shield, ArrowRight, Check, X } from "lucide-react";

interface ProviderRow {
  provider: string;
  maskedKey: string;
  configured: boolean;
  isOldKey: boolean;
  defaultModel: string;
  docsUrl: string;
  envVar: string;
  freeTierInfo: string;
  maskedCloudflareAccountId?: string;
  stats: {
    totalCalls: number;
    successCount: number;
    failureCount: number;
    avgResponseTimeMs: number;
    inCooldown: boolean;
    lastErrorMessage: string | null;
  };
}

export default function LLMKeysPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [cfAccountId, setCfAccountId] = useState("");
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string; ms?: number; model?: string }>>({});
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : "";
  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const fetchAll = useCallback(async () => {
    if (!token) { router.push("/login"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/llm-keys", { headers: authHeaders });
      if (res.status === 401) { router.push("/login"); return; }
      if (res.status === 403) { router.push("/"); return; }
      const data = await res.json();
      setProviders(data.providers || []);
      setConfiguredProviders(data.configuredProviders || []);
      const cfRow = (data.providers || []).find((p: ProviderRow) => p.provider === "cloudflare");
      if (cfRow?.maskedCloudflareAccountId) setCfAccountId("__masked__");
    } catch (e: any) { setError(e?.message || "خطأ"); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleSetKey = async (p: string) => {
    const v = (keyInputs[p] || "").trim();
    if (!v) return;
    setBusy(`set-${p}`);
    try {
      const r = await fetch("/api/admin/llm-keys", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ action: "set_key", provider: p, apiKey: v }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      setKeyInputs({ ...keyInputs, [p]: "" });
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const handleSetCfAccount = async () => {
    if (cfAccountId === "__masked__") return;
    const v = cfAccountId.trim();
    if (!v) return;
    setBusy("set-cf-account");
    try {
      const r = await fetch("/api/admin/llm-keys", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ action: "set_cloudflare_account", accountId: v }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      setCfAccountId("__masked__");
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const handleTest = async (p: string) => {
    setBusy(`test-${p}`);
    setTestResults({ ...testResults, [p]: { ok: false, msg: "جاري الاختبار..." } });
    try {
      const r = await fetch("/api/admin/llm-keys", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ action: "test", provider: p }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setTestResults({
          ...testResults,
          [p]: { ok: true, msg: d.response || "نجح", ms: d.responseTimeMs, model: d.model },
        });
      } else {
        setTestResults({ ...testResults, [p]: { ok: false, msg: d.error || "فشل" } });
      }
    } catch (e: any) {
      setTestResults({ ...testResults, [p]: { ok: false, msg: e.message } });
    }
    finally { setBusy(null); }
  };

  const handleReset = async (p: string) => {
    setBusy(`reset-${p}`);
    try {
      const r = await fetch("/api/admin/llm-keys", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ action: "reset_cooldown", provider: p }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const handleResetAll = async () => {
    setBusy("reset-all");
    try {
      const r = await fetch("/api/admin/llm-keys", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ action: "reset_cooldown", provider: "all" }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "خطأ"); return; }
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" dir="rtl">
      <Loader2 className="h-8 w-8 animate-spin text-cyan-accent" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6" dir="rtl">
      <div className="max-w-7xl mx-auto">
        <Card className="studio-panel border-cyan-accent/30 mb-6">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                  <Key className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold">إدارة مفاتيح المزودين</h1>
                  <p className="text-sm text-muted-foreground">
                    {providers.length} مزود · {configuredProviders.length} مُفعّل · ZAI المدمج دائماً يعمل كأمان
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleResetAll} variant="outline" size="sm" disabled={busy === "reset-all"}>
                  {busy === "reset-all" ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : <RotateCcw className="h-4 w-4 ml-2" />}
                  إعادة تفعيل الكل
                </Button>
                <Button onClick={() => router.push("/control-panel")} variant="outline" size="sm">
                  <ArrowRight className="h-4 w-4 ml-2" />لوحة التحكم
                </Button>
                <Button onClick={() => router.push("/")} variant="outline" size="sm">
                  <ArrowRight className="h-4 w-4 ml-2" />الرئيسية
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-500/10 text-red-400 text-sm text-center">{error}</div>
        )}

        <Card className="studio-panel">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-5 w-5" />
              المزودون ({providers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المزود</TableHead>
                    <TableHead>الحصة المجانية</TableHead>
                    <TableHead>الموديل الافتراضي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead>المفتاح الحالي</TableHead>
                    <TableHead>إحصائيات</TableHead>
                    <TableHead className="min-w-[280px]">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((row) => {
                    const p = row.provider;
                    const isCf = p === "cloudflare";
                    const isZai = row.isOldKey;
                    const tr = testResults[p];
                    return (
                      <TableRow key={p}>
                        <TableCell className="font-mono font-semibold align-top">
                          {p}
                          {isZai && <Badge variant="default" className="ml-2 bg-amber-500 text-black">مدمج</Badge>}
                          <div className="text-xs text-muted-foreground mt-1 font-normal">
                            <code>{row.envVar}</code>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground align-top max-w-[180px]">
                          {row.freeTierInfo}
                        </TableCell>
                        <TableCell className="text-xs font-mono align-top max-w-[220px]">
                          {row.defaultModel}
                        </TableCell>
                        <TableCell className="align-top">
                          {row.configured ? (
                            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                              <Check className="h-3 w-3 ml-1" /> مفعّل
                            </Badge>
                          ) : (
                            <Badge variant="outline">
                              <X className="h-3 w-3 ml-1" /> غير مفعّل
                            </Badge>
                          )}
                          {row.stats.inCooldown && (
                            <Badge variant="destructive" className="block mt-1">في تبريد</Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs align-top">
                          {row.maskedKey || <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-xs align-top">
                          <div>نجاح: <span className="text-emerald-400">{row.stats.successCount}</span></div>
                          <div>فشل: <span className="text-red-400">{row.stats.failureCount}</span></div>
                          <div>إجمالي: {row.stats.totalCalls}</div>
                          {row.stats.avgResponseTimeMs > 0 && (
                            <div className="text-muted-foreground mt-1">
                              ~{Math.round(row.stats.avgResponseTimeMs)}ms
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-2 min-w-[260px]">
                            {!isZai && (
                              <div className="flex gap-2">
                                <Input
                                  type="password"
                                  placeholder={isCf ? "CLOUDFLARE_API_TOKEN" : `${row.envVar}=...`}
                                  value={keyInputs[p] || ""}
                                  onChange={(e) => setKeyInputs({ ...keyInputs, [p]: e.target.value })}
                                  className="h-8 text-xs font-mono"
                                  disabled={busy === `set-${p}`}
                                />
                                <Button
                                  size="sm" variant="default"
                                  disabled={!keyInputs[p] || busy === `set-${p}`}
                                  onClick={() => handleSetKey(p)}
                                  className="h-8"
                                >
                                  {busy === `set-${p}` ? <Loader2 className="h-3 w-3 animate-spin" /> : "حفظ"}
                                </Button>
                              </div>
                            )}
                            {isCf && (
                              <div className="flex gap-2">
                                <Input
                                  type="password"
                                  placeholder="CLOUDFLARE_ACCOUNT_ID"
                                  value={cfAccountId === "__masked__" ? "" : cfAccountId}
                                  onChange={(e) => setCfAccountId(e.target.value)}
                                  onFocus={() => cfAccountId === "__masked__" && setCfAccountId("")}
                                  className="h-8 text-xs font-mono"
                                  disabled={busy === "set-cf-account"}
                                />
                                <Button
                                  size="sm" variant="outline"
                                  disabled={!cfAccountId || cfAccountId === "__masked__" || busy === "set-cf-account"}
                                  onClick={handleSetCfAccount}
                                  className="h-8"
                                >
                                  {busy === "set-cf-account" ? <Loader2 className="h-3 w-3 animate-spin" /> : "حفظ المعرّف"}
                                </Button>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <Button
                                size="sm" variant="outline"
                                disabled={!row.configured || busy === `test-${p}`}
                                onClick={() => handleTest(p)}
                                className="h-8"
                              >
                                {busy === `test-${p}` ? <Loader2 className="h-3 w-3 animate-spin ml-1" /> : <FlaskConical className="h-3 w-3 ml-1" />}
                                اختبار
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                disabled={!row.stats.inCooldown || busy === `reset-${p}`}
                                onClick={() => handleReset(p)}
                                className="h-8"
                              >
                                <RotateCcw className="h-3 w-3 ml-1" />
                                رفع الحظر
                              </Button>
                              <a
                                href={row.docsUrl} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-cyan-accent hover:underline self-center mr-1"
                              >
                                الحصول على مفتاح ↗
                              </a>
                            </div>
                            {tr && (
                              <div className={`text-xs p-2 rounded border ${
                                tr.ok
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                                  : "bg-red-500/10 border-red-500/30 text-red-300"
                              }`}>
                                <div className="flex items-center gap-1 font-medium">
                                  {tr.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                  {tr.ok ? `نجح · ${tr.ms}ms · ${tr.model}` : "فشل"}
                                </div>
                                <div className="mt-1 break-words">{tr.msg}</div>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="studio-panel mt-6">
          <CardContent className="p-4 text-xs text-muted-foreground space-y-2">
            <div className="font-medium text-foreground">ملاحظات:</div>
            <div>· الأولوية: المزود المُفضّل أولاً، ثم المُفعّلون بالترتيب، ثم <code>ZAI</code> المدمج كأمان أخير.</div>
            <div>· قاطع الدارة الذكي: 3 إخفاقات متتالية → تبريد 5 دقائق (يمكن رفعه يدوياً).</div>
            <div>· المفاتيح تُحفظ في جدول <code>Setting</code> بقاعدة البيانات، fallback إلى متغيرات البيئة في <code>.env</code>.</div>
            <div>· Cloudflare يحتاج مفتاحين: معرف الحساب (Account ID) + رمز API Token.</div>
            <div>· GitHub Models يستخدم GitHub PAT بنطاق <code>read:models</code> أو <code>models:read</code>.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
