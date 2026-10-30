"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bot, User, Home, LogOut, Send, Mic, Volume2, Square, Crown, Sparkles } from "lucide-react";

interface ChatMsg { role: "user" | "assistant"; content: string; ts: number; meta?: any; }
const SUGGESTED = ["اعرض قائمة المستخدمين", "اعرض قائمة المساعدين", "حالة النظام", "أنشئ نسخة احتياطية", "أنشئ تقرير يومي", "أعد تشغيل خدمة تبديل الوجه"];

export default function AdminAssistantPage() {
  const router = useRouter();
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ role: "assistant", content: "مرحباً! أنا وكيلك الذكي. أرسل لي أي أمر وسأنفذه فوراً.", ts: Date.now() }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("authToken") || "" : "";
  const authHeaders: Record<string, string> = { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  useEffect(() => { setVoiceSupported(typeof window !== "undefined" && (("webkitSpeechRecognition" in window) || ("SpeechRecognition" in window))); }, []);
  useEffect(() => {
    if (!token) { router.push("/login"); return; }
    fetch("/api/auth/me", { headers: authHeaders }).then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setMe(d); if (d.role !== "admin" && d.role !== "assistant" && !d.isOwner) { router.push("/"); } })
      .catch(() => router.push("/login"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const clean = text.replace(/[*#`_>\-]/g, "").replace(/[📊✅❌⚠️🚫📨🔄📋👥💾✨]/gu, "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    try { window.speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(clean); u.lang = "ar-SA"; u.rate = 0.95;
      u.onstart = () => setSpeaking(true); u.onend = () => setSpeaking(false); u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  const startListening = useCallback(() => {
    if (!voiceSupported) return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return;
    const r = new SR(); r.lang = "ar-SA"; r.continuous = false; r.interimResults = false;
    r.onstart = () => setListening(true);
    r.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput(t); setTimeout(() => send(t), 300); };
    r.onend = () => setListening(false); r.onerror = () => setListening(false);
    recRef.current = r; r.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSupported]);

  const stopSpeaking = useCallback(() => { if (window.speechSynthesis) { window.speechSynthesis.cancel(); setSpeaking(false); } }, []);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setMsgs(m => [...m, { role: "user", content: text.trim(), ts: Date.now() }]);
    setInput(""); setBusy(true);
    setMsgs(m => [...m, { role: "assistant", content: "⏳ جارٍ التحليل والتنفيذ...", ts: Date.now() }]);
    try {
      const r = await fetch("/api/admin/command", { method: "POST", headers: authHeaders, body: JSON.stringify({ command: text.trim() }) });
      const d = await r.json();
      setMsgs(m => m.filter(x => x.content !== "⏳ جارٍ التحليل والتنفيذ..."));
      if (!r.ok) { const e = { role: "assistant" as const, content: `❌ ${d.error || "خطأ"}`, ts: Date.now() }; setMsgs(m => [...m, e]); if (autoSpeak) speak(e.content); return; }
      const reply = { role: "assistant" as const, content: d.reply || d.execution?.message || "تم", ts: Date.now(), meta: { action: d.parsed?.action, success: d.execution?.success } };
      setMsgs(m => [...m, reply]); if (autoSpeak) speak(reply.content);
    } catch (e: any) {
      setMsgs(m => m.filter(x => x.content !== "⏳ جارٍ التحليل والتنفيذ..."));
      setMsgs(m => [...m, { role: "assistant", content: `❌ ${e.message}`, ts: Date.now() }]);
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, autoSpeak, speak, token]);

  const handleLogout = async () => {
    try { await fetch("/api/auth/logout", { method: "POST", headers: authHeaders }); } catch {}
    localStorage.removeItem("authToken"); router.push("/login");
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6" dir="rtl">
      <div className="max-w-4xl mx-auto">
        <Card className="studio-panel border-cyan-accent/30 mb-4">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500 to-fuchsia-500 flex items-center justify-center"><Bot className="h-6 w-6 text-white" /></div>
                <div><h1 className="text-xl font-bold flex items-center gap-2">وكيل أوامر المدير{me?.isOwner && <Badge variant="default" className="bg-amber-500 text-black text-[10px]">مالك</Badge>}</h1>
                  <p className="text-xs text-muted-foreground">مسجل: {me?.name || "—"} · اكتب أو تحدث بأمر وسأنفذه</p></div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setAutoSpeak(v => !v)} className={autoSpeak ? "bg-cyan-accent/20 text-cyan-accent" : ""}><Volume2 className="h-4 w-4" />رد صوتي</Button>
                <Button onClick={() => router.push("/control-panel")} variant="outline" size="sm">لوحة التحكم</Button>
                <Button onClick={() => router.push("/reports")} variant="outline" size="sm">التقارير</Button>
                <Button onClick={() => router.push("/")} variant="outline" size="sm"><Home className="h-4 w-4" /></Button>
                <Button onClick={handleLogout} variant="outline" size="sm"><LogOut className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardContent>
        </Card>
        {error && <div className="mb-4 p-3 rounded-md bg-red-500/10 text-red-400 text-sm text-center">{error}</div>}
        <Card className="studio-panel"><CardContent className="p-3 sm:p-4">
          <div ref={scrollRef} className="h-[55vh] overflow-y-auto rounded-md bg-black/30 p-3 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={`flex items-start gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs ${m.role === "user" ? "bg-cyan-accent/20 text-cyan-accent" : "bg-gradient-to-br from-amber-500 to-fuchsia-500 text-white"}`}>{m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</div>
                <div className={`flex-1 max-w-[80%] text-sm rounded-lg px-3 py-2 whitespace-pre-wrap ${m.role === "user" ? "bg-cyan-accent/10 text-cyan-accent" : "bg-muted/40 text-foreground"}`}>
                  {m.content}
                  {m.meta?.action && <div className="text-[10px] mt-1 pt-1 border-t border-border/40 text-muted-foreground">الإجراء: {m.meta.action} · {m.meta.success ? "✓ ناجح" : "✗ فشل"}</div>}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />جارٍ المعالجة...</div>}
          </div>
          <div className="flex items-center gap-1.5 mt-3 p-2 rounded-md bg-black/30 border border-cyan-accent/20">
            {voiceSupported && <Button variant="ghost" size="icon" onClick={listening ? () => recRef.current?.stop() : startListening} className={`h-9 w-9 shrink-0 ${listening ? "bg-red-500/20 text-red-400" : ""}`} disabled={busy}>{listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</Button>}
            {speaking && <Button variant="ghost" size="icon" onClick={stopSpeaking} className="h-9 w-9 shrink-0 bg-amber-500/20 text-amber-400"><Volume2 className="h-4 w-4 animate-pulse" /></Button>}
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} placeholder="اكتب أمرك..." className="flex-1 h-9 text-sm bg-transparent border-0 focus:outline-none px-2" disabled={busy} />
            <Button size="sm" onClick={() => void send(input)} disabled={busy || !input.trim()} className="bg-cyan-accent text-black h-9 px-3 shrink-0">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
          </div>
          <div className="mt-3">
            <p className="text-[10px] text-muted-foreground mb-1.5">أوامر مقترحة:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED.map(c => <button key={c} onClick={() => !busy && send(c)} disabled={busy} className="text-[11px] px-2 py-1 rounded-full bg-cyan-accent/10 text-cyan-accent hover:bg-cyan-accent/20 transition disabled:opacity-50">{c}</button>)}
            </div>
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}
