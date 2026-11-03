"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  Send,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Loader2,
  User,
  CheckCircle2,
  XCircle,
  BookOpen,
  Search,
  Lightbulb,
  BrainCircuit,
  Zap,
} from "lucide-react";

/**
 * TransplantAgentChat — وكيل دردشة يعمل على خمس مراحل ظاهرة ودقيقة:
 *   القراءة ← التحليل ← التفكير ← الفهم ← التنفيذ
 *
 * كل مرحلة تظهر مباشرة أثناء العمل مع ملخصها وقياساتها الحقيقية
 * (أبعاد الصور، ثقة الكشف، مواقع الأجزاء، عامل التحجيم، نسبة المطابقة،
 * زمن كل مرحلة) ثم النتيجة النهائية بدون أي تشويه.
 *
 * الصوت: Web Speech API للإدخال + speechSynthesis لقراءة رد الوكيل.
 */

type StageStatus = "pending" | "active" | "done" | "error";

type Stage = {
  id: string;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  status: StageStatus;
  ms?: number;
  summary?: string;
  items?: string[];
};

type Msg = {
  role: "user" | "agent";
  text: string;
  stages?: Stage[];
  steps?: string[]; // توافق مع الردود القديمة
  img?: string;
  error?: boolean;
};

interface TransplantAgentChatProps {
  sourcePath: string | null;
  refPath: string | null;
  onResult: (url: string, w: number, h: number) => void;
}

const EXAMPLES = ["انقل الرأس", "انقل الزراعين", "انقل الصدر", "انقل الخلفية", "انقل الرسمة"];

const STAGE_DEFS: Array<{ id: string; title: string; Icon: Stage["Icon"] }> = [
  { id: "reading", title: "القراءة", Icon: BookOpen },
  { id: "analysis", title: "التحليل", Icon: Search },
  { id: "thinking", title: "التفكير", Icon: Lightbulb },
  { id: "understanding", title: "الفهم", Icon: BrainCircuit },
  { id: "execution", title: "التنفيذ", Icon: Zap },
];

/* أزمنة تقدّم العرض المرحلي أثناء انتظار الرد (ملّي ثانية) */
const GATES = [450, 1150, 2050, 2750];

const WAIT_LINES: Record<string, string> = {
  reading: "أقرأ رسالتك وأفحص الصورتين...",
  analysis: "أحلل الأمر وأحدد الجزء ومكانه الهدف...",
  thinking: "أخطّط طريقة النقل والمطابقة والدمج...",
  understanding: "أتحقق من فهمي وجدوى التنفيذ...",
  execution: "أنفّذ النقل والدمج بدقة...",
};

const newStages = (): Stage[] =>
  STAGE_DEFS.map((d, i) => ({
    ...d,
    status: i === 0 ? ("active" as StageStatus) : ("pending" as StageStatus),
    items: [],
  }));

/* يقدّم حالات المراحل بصرياً حسب الزمن المنقضي أثناء انتظار الرد */
const advanceStages = (stages: Stage[], elapsed: number): Stage[] =>
  stages.map((st, i) => {
    if (st.status === "done" || st.status === "error") return st;
    const gate = GATES[i] ?? Number.POSITIVE_INFINITY;
    const summary = WAIT_LINES[st.id];
    if (i === stages.length - 1) {
      return elapsed >= gate ? { ...st, status: "active", summary } : st;
    }
    if (elapsed >= gate) return { ...st, status: "done", summary };
    if (i > 0 && elapsed >= (GATES[i - 1] ?? 0)) return { ...st, status: "active", summary };
    return st;
  });

const fmtMs = (ms?: number) => {
  if (typeof ms !== "number" || !isFinite(ms)) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
};

/* دمج بيانات المراحل الحقيقية القادمة من الخادم في خط المراحل المعروض */
const applyServerStages = (local: Stage[], server: any[]): Stage[] => {
  const byId = new Map<string, any>((server || []).map((s: any) => [s.id, s]));
  return local.map((st) => {
    const s = byId.get(st.id);
    if (!s) return st;
    return {
      ...st,
      status: "done" as StageStatus,
      ms: typeof s.ms === "number" ? s.ms : st.ms,
      summary: s.summary || st.summary,
      items: Array.isArray(s.items) && s.items.length ? s.items : st.items,
    };
  });
};

/* minimal typings for the Web Speech API */
type SRType = any;

export default function TransplantAgentChat({ sourcePath, refPath, onResult }: TransplantAgentChatProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "agent",
      text: "أنا وكيل النقل الذكي 👋 — أعمل على خمس مراحل: القراءة، التحليل، التفكير، الفهم، التنفيذ. ارفع الصورتين ثم اطلب مثلاً: «انقل الرأس» وسأريك كل مرحلة أمامك بدقة.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const recRef = useRef<SRType>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const srSupported = typeof window !== "undefined" &&
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const speak = (text: string) => {
    if (!ttsOn || !ttsSupported) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ar-SA";
      u.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  };

  /* يحدّث آخر رسالة وكيل تحتوي خط مراحل */
  const patchLastAgent = (fn: (m: Msg) => Msg) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "agent" && next[i].stages) {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });

  const runCommand = async (command: string) => {
    if (!command.trim()) return;
    if (!sourcePath || !refPath) {
      pushMsg({ role: "agent", error: true, text: "ارفع الصورة الأساس وصورة المرجع أولاً ⬆️ ثم اطلب مني النقل." });
      return;
    }
    pushMsg({ role: "user", text: command });
    setInput("");
    setThinking(true);

    const startedAt = Date.now();
    pushMsg({ role: "agent", text: "", stages: newStages() });

    /* عرض المراحل تتقدم مباشرة أثناء انتظار الرد */
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const el = Date.now() - startedAt;
      patchLastAgent((m) => ({ ...m, stages: advanceStages(m.stages || [], el) }));
    }, 120);

    try {
      const res = await fetch("/api/images/agent-transplant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, refPath, command }),
      });
      const d = await res.json().catch(() => ({}));
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

      if (!res.ok || !d.url) {
        const errStages = Array.isArray(d.stages) && d.stages.length ? d.stages : null;
        patchLastAgent((m) => {
          let stages = m.stages;
          if (errStages) {
            stages = applyServerStages(m.stages || [], errStages).map((st, i, arr) =>
              i === arr.length - 1 ? { ...st, status: "error" as StageStatus } : st,
            );
          } else if (stages) {
            const idx = stages.findIndex((s) => s.status === "active" || s.status === "pending");
            stages = stages.map((st, i) =>
              i === idx ? { ...st, status: "error" as StageStatus, summary: "توقفت هنا بسبب خطأ" } : st,
            );
          }
          return { ...m, stages, text: d.error || d.message || "تعذر تنفيذ الأمر", error: true };
        });
        speak("تعذر تنفيذ الأمر");
        return;
      }

      /* نجاح: تعبئة المراحل بقياساتها الحقيقية ثم النتيجة */
      patchLastAgent((m) => ({
        ...m,
        stages: applyServerStages(m.stages || [], Array.isArray(d.stages) ? d.stages : []),
        text: "تم التنفيذ بنجاح ✓ — يمكنك معاينة النتيجة أدناه وسيتم تطبيقها على اللوحة",
        img: d.url,
      }));
      onResult(d.url, d.width, d.height);
      speak("تم نقل الجزء ودمجه بنجاح");
    } catch (e: any) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      patchLastAgent((m) => {
        let stages = m.stages;
        if (stages) {
          const idx = stages.findIndex((s) => s.status === "active" || s.status === "pending");
          stages = stages.map((st, i) =>
            i === idx ? { ...st, status: "error" as StageStatus, summary: "فشل الاتصال" } : st,
          );
        }
        return { ...m, stages, text: e?.message || "خطأ في الاتصال", error: true };
      });
    } finally {
      setThinking(false);
    }
  };

  const pushMsg = (m: Msg) => setMessages((prev) => [...prev, m]);

  /* ---------- voice input (Web Speech API) ---------- */

  const toggleMic = () => {
    if (!srSupported) {
      toast({ title: "المتصفح لا يدعم الإدخال الصوتي — استخدم Chrome أو Edge، أو اكتب الأمر" });
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec: SRType = new SR();
    rec.lang = "ar-SA";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
      }
      if (final.trim()) {
        setInput(final.trim());
        rec.stop();
        setListening(false);
        runCommand(final.trim());
      }
    };
    rec.onerror = () => {
      setListening(false);
      toast({ title: "لم أسمع شيئاً — تأكد من صلاحية الميكروفون" });
    };
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  /* ---------- render ---------- */

  const statusIcon = (st: Stage) => {
    if (st.status === "active") return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />;
    if (st.status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    if (st.status === "error") return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    return <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0 mx-1" />;
  };

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Bot className="w-5 h-5 text-primary" />
        <span className="text-sm font-semibold">المساعد الذكي — وكيل على خمس مراحل</span>
        <span className="text-[10px] text-muted-foreground">القراءة ← التحليل ← التفكير ← الفهم ← التنفيذ</span>
        <Button
          size="sm"
          variant={ttsOn ? "default" : "outline"}
          className="h-7 ms-auto"
          disabled={!ttsSupported}
          onClick={() => setTtsOn((v) => !v)}
          title={ttsSupported ? "نطق رد الوكيل" : "النطق غير مدعوم في هذا المتصفح"}
        >
          {ttsOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span className="text-[10px]">الصوت</span>
        </Button>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="max-h-80 overflow-y-auto space-y-2 rounded-md bg-muted/20 p-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[92%] rounded-md px-2.5 py-1.5 text-xs leading-relaxed ring-1 ${
                m.role === "user"
                  ? "bg-primary/10 ring-primary/30"
                  : m.error
                    ? "bg-red-500/10 ring-red-500/30 text-red-300"
                    : "bg-card ring-border"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                {m.role === "user" ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3 text-primary" />}
                <span className="text-[9px] text-muted-foreground">{m.role === "user" ? "أنت" : "الوكيل"}</span>
              </div>
              {m.text && <div>{m.text}</div>}

              {/* خط المراحل الخمس */}
              {m.stages && m.stages.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {m.stages.map((st, j) => (
                    <div
                      key={j}
                      className={`rounded-md px-2 py-1 ring-1 ${
                        st.status === "error"
                          ? "ring-red-500/40 bg-red-500/5"
                          : st.status === "pending"
                            ? "ring-border/50 bg-background/40 opacity-60"
                            : "ring-border/70 bg-background/70"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <st.Icon className="w-3.5 h-3.5 text-primary/80 shrink-0" />
                        <span className="text-[11px] font-semibold">{st.title}</span>
                        {statusIcon(st)}
                        {st.status === "done" && typeof st.ms === "number" && (
                          <span className="text-[9px] text-muted-foreground ms-auto">{fmtMs(st.ms)}</span>
                        )}
                      </div>
                      {st.status !== "pending" && st.summary && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">{st.summary}</div>
                      )}
                      {st.status === "done" && st.items && st.items.length > 0 && (
                        <ul className="mt-0.5 space-y-0.5">
                          {st.items.map((it, k) => (
                            <li key={k} className="flex items-start gap-1 text-[10px] text-muted-foreground">
                              <span className="text-primary/70 shrink-0">•</span>
                              <span className="break-words">{it}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* خطوات الردود القديمة (توافق) */}
              {m.steps && m.steps.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {m.steps.map((s, j) => (
                    <div key={j} className="flex items-start gap-1 text-[10px] text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-px" />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )}

              {m.img && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={m.img}
                  alt="نتيجة النقل"
                  className="mt-1.5 rounded-md ring-1 ring-border max-h-48 w-auto object-contain cursor-pointer hover:opacity-90"
                  onClick={() => window.open(m.img, "_blank")}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* example chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={thinking}
            onClick={() => runCommand(ex)}
            className="px-2 py-1 rounded-full text-[10px] bg-secondary hover:bg-secondary/70 ring-1 ring-border disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {/* input row */}
      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !thinking) {
              e.preventDefault();
              runCommand(input);
            }
          }}
          placeholder={listening ? "أتحدث... تحدث الآن" : "اكتب أمراً — مثال: انقل الرأس من المرجع"}
          className="flex-1 h-9 rounded-md bg-background px-3 text-xs ring-1 ring-border focus:ring-primary/50 outline-none"
          disabled={thinking}
        />
        <Button
          size="sm"
          variant={listening ? "destructive" : "outline"}
          className="h-9 w-9 p-0"
          onClick={toggleMic}
          disabled={thinking}
          title={listening ? "إيقاف الاستماع" : "تحدث"}
        >
          {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Button size="sm" className="h-9 px-3" onClick={() => runCommand(input)} disabled={thinking || !input.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
      {listening && (
        <div className="flex items-center gap-1.5 text-[10px] text-red-400">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          أستمع إليك... تحدث بوضوح ثم توقف
        </div>
      )}
    </Card>
  );
}
