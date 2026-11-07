"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Mic, MicOff, Send, Volume2, Loader2, Trash2, Brain, Eye, Wand2, CheckCircle2 } from "lucide-react";
import { useComposerStore, type ComposerPhase } from "./store";

const PHASES: { key: Exclude<ComposerPhase, "">; label: string; icon: typeof Brain }[] = [
  { key: "understand", label: "الفهم", icon: Eye },
  { key: "analyze", label: "التحليل", icon: Brain },
  { key: "apply", label: "التطبيق", icon: Wand2 },
  { key: "finalizing", label: "الإنهاء", icon: CheckCircle2 },
];

/** تشغيل نص صوتيًا عبر /api/voice/tts */
async function speak(text: string, audioRef: React.MutableRefObject<HTMLAudioElement | null>) {
  try {
    audioRef.current?.pause();
    const r = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error("فشل توليد الصوت");
    const b = await r.blob();
    const url = URL.createObjectURL(b);
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => URL.revokeObjectURL(url);
    await a.play();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "تعذر تشغيل الرد الصوتي");
  }
}

export function ComposerChat() {
  const messages = useComposerStore((s) => s.messages);
  const busy = useComposerStore((s) => s.busy);
  const phase = useComposerStore((s) => s.phase);
  const progress = useComposerStore((s) => s.progress);
  const ttsEnabled = useComposerStore((s) => s.ttsEnabled);
  const toggleTts = useComposerStore((s) => s.toggleTts);
  const addMessage = useComposerStore((s) => s.addMessage);
  const setBusy = useComposerStore((s) => s.setBusy);
  const setPhase = useComposerStore((s) => s.setPhase);
  const setProgress = useComposerStore((s) => s.setProgress);
  const size = useComposerStore((s) => s.size);

  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, phase]);

  // ---------- إرسال الطلب للوكيل ----------
  const send = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || busy) return;
      const st = useComposerStore.getState();
      const src = st.source.img;
      const ref = st.reference.img;
      const res = st.result.img;

      if (!src || !ref) {
        addMessage({ role: "agent", text: "⚠ ارفع صورة المصدر وصورة المرجع أولًا (المربعان الأول والثاني)، ثم اطلب ما تريد." });
        return;
      }

      addMessage({ role: "user", text });
      setInput("");
      setBusy(true);

      try {
        const body = res
          ? { resultPath: res.path, instruction: text, size: st.size || undefined }
          : { sourcePath: src.path, referencePath: ref.path, instruction: text, size: st.size || undefined };

        const r = await fetch("/api/images/compose-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? "تعذر بدء المهمة");

        // متابعة المهمة حتى الاكتمال
        const taskId: string = d.taskId;
        let done = false;
        for (let i = 0; i < 240 && !done; i++) {
          await new Promise((res2) => setTimeout(res2, 2000));
          try {
            const sr = await fetch(`/api/task/status?id=${taskId}`, { cache: "no-store" });
            if (!sr.ok) continue;
            const sd = await sr.json();
            if (sd.phase) setPhase(sd.phase);
            if (typeof sd.progress === "number") setProgress(sd.progress);
            if (sd.status === "done") {
              done = true;
              const img = useComposerStore.getState().result;
              useComposerStore.getState().setImage("result", {
                id: sd.result.path,
                name: sd.result.url.split("/").pop() ?? "compose.png",
                path: sd.result.path,
                url: sd.result.url,
                mime: "image/png",
                size: sd.result.size ?? 0,
                width: sd.result.width ?? 0,
                height: sd.result.height ?? 0,
                format: "png",
                uploadedAt: Date.now(),
              }, "compose-agent");
              addMessage({
                role: "agent",
                text:
                  `✅ تم بناء الصورة بنجاح${sd.result.method === "result-edit" ? " (تعديل على النتيجة السابقة)" : ""}.\n` +
                  `اطلب الآن أي منظر أو وضعية أخرى وسأعدّل عليها — أو استخدم أزرار المربع: تحسين الجودة، حفظ، طباعة، رجوع وتقدم.`,
                detail: sd.result.prompt,
              });
              if (useComposerStore.getState().ttsEnabled) speak("تم بناء الصورة بنجاح", audioRef);
            } else if (sd.status === "error") {
              done = true;
              addMessage({ role: "agent", text: `⚠ تعذر تنفيذ الطلب: ${sd.error ?? "خطأ غير معروف"}. جرّب صياغة أبسط مثل: «اجمعهما في صورة حفل زفاف».` });
            }
          } catch {
            /* استمرار المتابعة */
          }
        }
        if (!done) addMessage({ role: "agent", text: "⚠ انتهت مدة الانتظار — تحقق من مربع النتيجة بعد قليل، أو أعد المحاولة." });
      } catch (e) {
        addMessage({ role: "agent", text: `⚠ ${e instanceof Error ? e.message : "حدث خطأ — أعد المحاولة"}` });
      } finally {
        setBusy(false);
        setPhase("");
        setProgress(0);
      }
    },
    [input, busy, addMessage, setBusy, setPhase, setProgress]
  );

  // ---------- التسجيل الصوتي → ASR ----------
  const toggleMic = useCallback(async () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    if (transcribing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: mime || "audio/webm" });
        if (blob.size < 800) {
          toast.error("التسجيل قصير جدًا — اضغط المايك وتحدث ثم اضغط للإيقاف");
          return;
        }
        setTranscribing(true);
        try {
          const b64 = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(new Error("تعذر قراءة الصوت"));
            fr.readAsDataURL(blob);
          });
          const r = await fetch("/api/voice/asr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audioBase64: b64 }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d?.error ?? "فشل التعرف على الكلام");
          setInput((prev) => (prev ? prev + " " : "") + d.text);
          toast.success(`تم تحويل كلامك إلى نص ✓`);
          inputRef.current?.focus();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "فشل التعرف على الكلام");
        } finally {
          setTranscribing(false);
        }
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
      toast.info("🎙 جاري التسجيل… تحدّث ثم اضغط زر المايك مجددًا للإرسال");
    } catch {
      toast.error("تعذر الوصول إلى المايك — امنح الإذن للمتصفح");
    }
  }, [recording, transcribing]);

  const phaseIdx = PHASES.findIndex((p) => p.key === phase);

  return (
    <section className="studio-panel rounded-2xl border border-border bg-muted/20 p-3 flex flex-col gap-3 min-w-0" aria-label="دردشة الوكيل الذكي">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="text-sm font-bold">💬 الدردشة مع الوكيل الذكي</h3>
          <p className="text-[11px] text-muted-foreground">اكتب طلبك أو تحدث بالصوت — يفهم ويحلل ويطبّق مع المحافظة على الملامح</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <Volume2 className="h-4 w-4" />
            الرد الصوتي
            <Switch checked={ttsEnabled} onCheckedChange={toggleTts} aria-label="تشغيل الرد الصوتي" />
          </label>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => useComposerStore.getState().clearChat()} title="محادثة جديدة" aria-label="محادثة جديدة">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* شريط مراحل الوكيل */}
      {(busy || phase) && (
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-2.5">
          <div className="flex items-center justify-between gap-1 text-[11px] font-medium">
            {PHASES.map((p, i) => {
              const active = phaseIdx === i;
              const passed = phaseIdx > i || progress >= 100;
              const Icon = p.icon;
              return (
                <span
                  key={p.key}
                  className={`flex items-center gap-1 ${active ? "text-cyan-400 font-bold" : passed ? "text-emerald-400" : "text-muted-foreground/60"}`}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? "animate-pulse" : ""}`} />
                  {p.label}
                  {i < PHASES.length - 1 && <span className="mx-0.5 text-muted-foreground/40">←</span>}
                </span>
              );
            })}
            <span className="tabular-nums text-cyan-400 font-bold">{progress}%</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-gradient-to-l from-cyan-500 to-blue-500 transition-all duration-500" style={{ width: `${Math.max(progress, 4)}%` }} />
          </div>
        </div>
      )}

      {/* الرسائل */}
      <div ref={listRef} className="max-h-72 overflow-y-auto rounded-xl border border-border bg-background/50 p-2.5 space-y-2.5" role="log" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col gap-1 ${m.role === "user" ? "items-start" : "items-end"}`}>
            <div
              className={`max-w-[92%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-6 ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-bl-sm"
                  : "bg-muted text-foreground rounded-br-sm border border-border"
              }`}
            >
              {m.text}
              {m.detail && (
                <details className="mt-1.5 text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer select-none">وصف المشهد الذي نفّذه الوكيل</summary>
                  <p className="mt-1 leading-5" dir="ltr">{m.detail}</p>
                </details>
              )}
            </div>
            {m.role === "agent" && m.id !== "welcome" && (
              <button
                type="button"
                onClick={() => speak(m.text, audioRef)}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                aria-label="تشغيل الرسالة صوتيًا"
              >
                <Volume2 className="h-3 w-3" /> استماع
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex justify-end">
            <div className="bg-muted border border-border rounded-2xl rounded-br-sm px-3.5 py-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              الوكيل يعمل على طلبك…
            </div>
          </div>
        )}
      </div>

      {/* الإدخال */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon"
          variant={recording ? "destructive" : "outline"}
          className="h-10 w-10 shrink-0 rounded-full"
          onClick={toggleMic}
          disabled={busy || transcribing}
          title={recording ? "إيقاف التسجيل وإرساله للتحويل" : "تسجيل صوتي"}
          aria-label={recording ? "إيقاف التسجيل" : "تسجيل صوتي"}
        >
          {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </Button>
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={recording ? "🎙 جاري التسجيل…" : "مثال: اجمعهما في صورة حفل زفافهما والزوجة بشعر أسود طويل ناعم"}
          disabled={busy}
          className="flex-1"
          aria-label="نص الطلب"
        />
        <Button type="button" className="h-10 shrink-0" onClick={() => send()} disabled={busy || !input.trim()} aria-label="إرسال">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 rtl:rotate-180" />}
          إرسال
        </Button>
      </div>
      {size && <p className="text-[10px] text-muted-foreground">مقاس الصورة المحدد: {size}</p>}
    </section>
  );
}
