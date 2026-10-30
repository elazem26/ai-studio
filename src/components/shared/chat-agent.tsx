"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loader2, Send, Mic, Bot, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
interface LI { path: string; url: string; width: number; height: number; name: string; }
interface CM { role: "user" | "assistant"; content: string; ts: number; }
interface P { image: LI | null; onUpdate: (d: { path: string; url: string; width: number; height: number }) => void; compact?: boolean; className?: string; }
export function ChatAgent({ image, onUpdate, compact, className }: P) {
  const locale = useI18n(s => s.locale); const isAr = locale === "ar";
  const [msgs, setMsgs] = useState<CM[]>([]); const [input, setInput] = useState(""); const [busy, setBusy] = useState(false);
  const [vs, setVS] = useState(false); const [il, setIL] = useState(false); const rr = useRef<any>(null); const sr = useRef<HTMLDivElement>(null);
  useEffect(() => { setVS(typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)); }, []);
  useEffect(() => { if (sr.current) sr.current.scrollTop = sr.current.scrollHeight; }, [msgs]);
  const sv = useCallback(() => { if (!vs) return; const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition; if (!SR) return; const r = new SR(); r.lang = isAr ? "ar-SA" : "en-US"; r.onstart = () => setIL(true); r.onresult = (e: any) => setInput(e.results[0][0].transcript); r.onend = () => setIL(false); r.onerror = () => setIL(false); rr.current = r; r.start(); }, [vs, isAr]);
  const send = useCallback(async (text: string) => {
    if (!text.trim() || !image) return; setMsgs(m => [...m, { role: "user", content: text.trim(), ts: Date.now() }]); setInput(""); setBusy(true);
    setMsgs(m => [...m, { role: "assistant", content: isAr ? "⏳ جارٍ..." : "⏳ Processing...", ts: Date.now() }]);
    try {
      const r = await fetch("/api/images/agent-edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, instruction: text.trim(), wholeImage: true }) });
      let d: any; try { d = await r.json(); } catch { setMsgs(m => [...m, { role: "assistant", content: "❌ Timed out", ts: Date.now() }]); return; }
      if (!r.ok) { setMsgs(m => [...m, { role: "assistant", content: `❌ ${d.message ?? "error"}`, ts: Date.now() }]); return; }
      if (d.url) { onUpdate({ path: d.path, url: d.url, width: d.width, height: d.height }); setMsgs(m => [...m, { role: "assistant", content: "✅ Done", ts: Date.now() }]); return; }
      if (!d.taskId) return;
      for (let i = 0; i < 100; i++) { await new Promise(r => setTimeout(r, 3000)); const pr = await fetch(`/api/task/status?id=${d.taskId}`); let pd: any; try { pd = await pr.json(); } catch { continue; }
        if (pd.status === "done" && pd.result) { const r2 = pd.result; onUpdate({ path: r2.path, url: r2.url, width: r2.width, height: r2.height }); setMsgs(m => [...m, { role: "assistant", content: "✅ Done", ts: Date.now() }]); setTimeout(() => document.getElementById("result-box")?.scrollIntoView({ behavior: "smooth", block: "center" }), 100); return; }
        if (pd.status === "error") { setMsgs(m => [...m, { role: "assistant", content: `❌ ${pd.error ?? "error"}`, ts: Date.now() }]); return; } }
      setMsgs(m => [...m, { role: "assistant", content: "❌ Timed out", ts: Date.now() }]);
    } catch (e) { setMsgs(m => [...m, { role: "assistant", content: `❌ ${e instanceof Error ? e.message : ""}`, ts: Date.now() }]); }
    finally { setBusy(false); }
  }, [image, onUpdate, isAr]);
  if (!image) return (<Card className={cn("studio-panel border-panel-border", className)}><CardContent className={compact ? "py-3 text-center" : "py-6 text-center"}><Bot className="h-6 w-6 text-muted-foreground mx-auto mb-2" /><p className="text-xs text-muted-foreground">{isAr ? "ارفع صورة" : "Upload first"}</p></CardContent></Card>);
  return (
    <Card className={cn("studio-panel border-cyan-accent/30", className)}>
      <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Bot className="h-4 w-4 text-cyan-accent" />{isAr ? "وكيل ذكاء" : "AI Agent"}</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 p-2">
        <div ref={sr} className={cn("overflow-y-auto rounded-md bg-black/30 p-2 space-y-1.5", compact ? "max-h-[140px]" : "max-h-[220px]")}>
          {msgs.length === 0 ? <p className="text-[10px] text-muted-foreground text-center py-4">{isAr ? "اكتب أو تحدث..." : "Type or speak..."}</p> : msgs.map((m, i) => (<div key={i} className={cn("flex items-start gap-2", m.role === "user" && "flex-row-reverse")}><div className={cn("shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px]", m.role === "user" ? "bg-cyan-accent/20 text-cyan-accent" : "bg-emerald-500/20 text-emerald-400")}>{m.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}</div><div className={cn("flex-1 text-[11px] rounded-md px-2 py-1", m.role === "user" ? "bg-cyan-accent/10 text-cyan-accent" : "bg-muted/40")}>{m.content}</div></div>))}
          {busy && <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{isAr ? "جارٍ..." : "Processing..."}</div>}
        </div>
        <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-black/30 border border-cyan-accent/20">
          {vs && <Button variant="ghost" size="sm" onClick={sv} disabled={busy} className={cn("h-8 w-8 p-0 shrink-0", il && "bg-red-500/20 text-red-400")}><Mic className={cn("h-3.5 w-3.5", il && "animate-pulse")} /></Button>}
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} placeholder={isAr ? "مثال: اجعل الخلفية زرقاء" : "e.g., make bg blue"} className="flex-1 h-8 text-[11px] bg-transparent border-0 focus:outline-none px-1" disabled={busy} />
          <Button size="sm" onClick={() => void send(input)} disabled={busy || !input.trim()} className="h-8 px-2 shrink-0 bg-cyan-accent text-black">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
