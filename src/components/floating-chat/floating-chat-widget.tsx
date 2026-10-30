"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, Send, Mic, X, MessageCircle, Volume2, Square, Sparkles } from "lucide-react";

interface Msg { role: "user" | "assistant"; content: string; ts: number; }
const SUGGESTIONS = ["كيف أبدل ملابس صورة؟", "ما هي الخدمات المتاحة؟", "كيف أرفع جودة الصورة؟", "كيف أحفظ مشروعي؟"];

export function FloatingChatWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "assistant", content: "مرحباً! أنا مساعدك الذكي. اسألني عن أي شيء.", ts: Date.now() }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isAdminPage = pathname?.startsWith("/admin-assistant") || pathname?.startsWith("/control-panel") || pathname?.startsWith("/reports");
  useEffect(() => { setVoiceSupported(typeof window !== "undefined" && (("webkitSpeechRecognition" in window) || ("SpeechRecognition" in window))); }, []);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs]);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const clean = text.replace(/[*#`_>\-]/g, "").replace(/[📊✅❌⚠️🚫✨🎨📸]/gu, "").replace(/\s+/g, " ").trim();
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
    setMsgs(m => [...m, { role: "assistant", content: "⏳ أفكر...", ts: Date.now() }]);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: text.trim() }], context: { locale: "ar" } }) });
      const d = await r.json();
      setMsgs(m => m.filter(x => x.content !== "⏳ أفكر..."));
      const reply = d.response || d.error || "عذراً، لم أتمكن من الرد.";
      setMsgs(m => [...m, { role: "assistant", content: reply, ts: Date.now() }]);
      if (autoSpeak) speak(reply);
    } catch (e: any) {
      setMsgs(m => m.filter(x => x.content !== "⏳ أفكر..."));
      setMsgs(m => [...m, { role: "assistant", content: `❌ ${e.message}`, ts: Date.now() }]);
    } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, autoSpeak, speak]);

  if (isAdminPage) return null;

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-4 left-4 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg shadow-cyan-500/30 flex items-center justify-center text-white hover:scale-110 transition-transform" aria-label="افتح المساعد الذكي">
          <MessageCircle className="h-6 w-6" />
          <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-4 left-4 z-50 w-[min(380px,calc(100vw-2rem))] h-[min(560px,calc(100vh-2rem))] flex flex-col bg-background border border-cyan-accent/30 rounded-xl shadow-2xl overflow-hidden" dir="rtl">
          <div className="flex items-center justify-between p-3 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border-b border-cyan-accent/30">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"><Sparkles className="h-4 w-4 text-white" /></div>
              <div><div className="text-sm font-medium">مساعد المستخدم</div><div className="text-[10px] text-muted-foreground">اسأل عن أي شيء</div></div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAutoSpeak(v => !v)} title="رد صوتي تلقائي"><Volume2 className={`h-3.5 w-3.5 ${autoSpeak ? "text-cyan-accent" : ""}`} /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 bg-black/20">
            {msgs.map((m, i) => (
              <div key={i} className={`flex items-start gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[10px] ${m.role === "user" ? "bg-cyan-accent/20 text-cyan-accent" : "bg-gradient-to-br from-cyan-500 to-blue-500 text-white"}`}>{m.role === "user" ? "أ" : <Sparkles className="h-3 w-3" />}</div>
                <div className={`flex-1 max-w-[80%] text-xs rounded-lg px-2.5 py-1.5 whitespace-pre-wrap ${m.role === "user" ? "bg-cyan-accent/10 text-cyan-accent" : "bg-muted/40"}`}>{m.content}</div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />جارٍ المعالجة...</div>}
          </div>
          {msgs.length <= 2 && (
            <div className="px-3 pb-2"><div className="flex flex-wrap gap-1">
              {SUGGESTIONS.map(s => <button key={s} onClick={() => !busy && send(s)} disabled={busy} className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-accent/10 text-cyan-accent hover:bg-cyan-accent/20 disabled:opacity-50">{s}</button>)}
            </div></div>
          )}
          <div className="p-2 border-t border-border bg-black/30 flex items-center gap-1">
            {voiceSupported && <Button variant="ghost" size="icon" onClick={listening ? () => recRef.current?.stop() : startListening} className={`h-8 w-8 shrink-0 ${listening ? "bg-red-500/20 text-red-400" : ""}`} disabled={busy}>{listening ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}</Button>}
            {speaking && <Button variant="ghost" size="icon" onClick={stopSpeaking} className="h-8 w-8 shrink-0 bg-amber-500/20 text-amber-400"><Volume2 className="h-3.5 w-3.5 animate-pulse" /></Button>}
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} placeholder="اكتب سؤالك..." className="flex-1 h-8 text-xs bg-transparent border-0 focus:outline-none px-1" disabled={busy} />
            <Button size="icon" onClick={() => void send(input)} disabled={busy || !input.trim()} className="bg-cyan-accent text-black h-8 w-8 shrink-0">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</Button>
          </div>
        </div>
      )}
    </>
  );
}
