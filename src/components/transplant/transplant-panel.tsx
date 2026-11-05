"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ProgressIndicator } from "@/components/shared/progress-indicator";
import { MaskEditor } from "@/components/transplant/mask-editor";
import { FaceBoxes, type FaceBox } from "@/components/transplant/face-boxes";
import {
  EnhanceQualityButtons,
  type EnhancedResult,
} from "@/components/shared/enhance-quality-buttons";
import {
  Upload,
  X,
  Plus,
  Download,
  ExternalLink,
  Printer,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
  RotateCw,
  User2,
  Cat,
  Image as ImageIcon,
  ScanFace,
  Wand2,
  Bot,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
} from "lucide-react";

/**
 * TransplantPanel — نقل الأجزاء بين الصور + وكيل ذكي (كتابة وصوت).
 *
 * The built-in AGENT understands Arabic commands (typed or SPOKEN):
 * "انقل الرأس" / "انقل الذراعين" / "انقل الصدر" / "انقل الخلفية"
 * "انقل القط" / "كبّر 20%" … and executes the FULL pipeline automatically:
 * segmentation → selection → copy → resize → skin-tone/lighting matching
 * → Poisson blending — no manual steps.
 */

type Mode = "head" | "person" | "object" | "background";
type Region = "full" | "hair" | "face" | "chest" | "torso" | "arms" | "legs";

const MODES: { key: Mode; label: string; hint: string; icon: any }[] = [
  { key: "head", label: "الرأس / الوجه", hint: "دمج رأس المرجع على رأس المصدر مع مطابقة حجم البشرة والإضاءة ولون الشعر", icon: ScanFace },
  { key: "person", label: "جسم كامل", hint: "نقل الشخص كاملاً من المرجع إلى المصدر مع مطابقة الحجم تلقائياً", icon: User2 },
  { key: "object", label: "كائن / حيوان", hint: "نقل أي كائن أو حيوان أو رسمة من المرجع ووضعه في المشهد بواقعية", icon: Cat },
  { key: "background", label: "الخلفية", hint: "إبقاء شخص المصدر ونقل خلفية المرجع خلفه", icon: ImageIcon },
];

function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function ActionBar({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap p-2 bg-card/60 border-y border-border/50">
      <Button size="sm" variant="outline" className="h-8" onClick={() => { const t = window.open("", "_blank"); if (t) t.location.href = url; }}>
        <ExternalLink className="w-3.5 h-3.5 me-1" />
        <span className="text-xs">فتح</span>
      </Button>
      <Button size="sm" variant="outline" className="h-8" onClick={() => downloadUrl(url, `${label}-${Date.now()}.png`)}>
        <Download className="w-3.5 h-3.5 me-1" />
        <span className="text-xs">حفظ</span>
      </Button>
      <Button size="sm" variant="outline" className="h-8" onClick={() => {
        const t = window.open("", "_blank");
        if (t) {
          t.document.write(`<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff"><img src="${url}" style="max-width:100%;max-height:100vh"/></body></html>`);
          t.document.close();
          setTimeout(() => { t.focus(); t.print(); }, 250);
        }
      }}>
        <Printer className="w-3.5 h-3.5 me-1" />
        <span className="text-xs">طباعة</span>
      </Button>
    </div>
  );
}

function DropSlot({
  title, subtitle, preview, onPick, onClear, accent, overlayUrl, selectionLabel, onClearSelection,
  faces = [], selectedFace = null, tone = "cyan", onPickFace, footer,
}: {
  title: string;
  subtitle: string;
  preview: string | null;
  onPick: (f: File) => void;
  onClear: () => void;
  accent: string;
  overlayUrl?: string | null;
  selectionLabel?: string | null;
  onClearSelection?: () => void;
  faces?: FaceBox[];
  selectedFace?: number | null;
  tone?: "cyan" | "fuchsia";
  onPickFace?: (i: number) => void;
  /** أزرار الطباعة/الحفظ والتحسين — تحت مربع الصورة مباشرة */
  footer?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${accent}`} />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {preview && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClear}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.currentTarget.blur(); inputRef.current?.click(); }}
        className="relative rounded-lg border-2 border-dashed border-border/70 hover:border-primary/60 transition-colors overflow-hidden bg-card/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
        style={{ aspectRatio: "3 / 4" }}
      >
        {overlayUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={overlayUrl} alt={`${title} — التحديد`} className="absolute inset-0 w-full h-full object-cover" />
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground px-3 text-center">
            <Upload className="w-6 h-6" />
            <span className="text-xs leading-5">{subtitle}</span>
          </span>
        )}
        {preview && !overlayUrl && (
          <FaceBoxes faces={faces} selected={selectedFace} tone={tone} onPick={(i) => onPickFace?.(i)} />
        )}
      </button>
      {faces.length > 1 && !selectionLabel && (
        <div className="text-[11px] text-muted-foreground px-0.5">
          اضغط المربع المرقم لاختيار الشخص ({faces.length} أشخاص)
        </div>
      )}
      {overlayUrl && selectionLabel && (
        <div className="flex items-center justify-between gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1">
          <span className="text-[11px] font-semibold text-emerald-600 truncate">✓ التحديد: {selectionLabel}</span>
          {onClearSelection && (
            <button type="button" className="text-[11px] text-emerald-700 hover:underline shrink-0" onClick={onClearSelection}>
              إلغاء
            </button>
          )}
        </div>
      )}
      {footer}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.currentTarget.value = "";
          e.currentTarget.blur();
          if (f) onPick(f);
        }}
      />
    </div>
  );
}

/* ============================== AGENT ============================== */

type ChatMsg = { role: "user" | "agent"; text: string };


/* ============================== PANEL ============================== */

/** تحديد معتمد ظاهر على الصورة — يُعاد إرسال قناعه عند التنفيذ */
type Selection = {
  side: "ref" | "source";
  overlay: string;
  mask: string;
  label: string;
  spec: any;
  areaPct?: number;
  /** عدّل المستخدم القناع بالماوس؟ → الخادم ينفذ القناع حرفياً */
  edited?: boolean;
};

const SEL_CHIPS = [
  "الرأس", "الوجه", "الشعر", "العينان", "الصدر", "الذراعان",
  "الرجلان", "الخلفية", "الشخص على اليمين", "النصف العلوي",
  "الشخص الأول", "الشخص الثاني", "المرجع الثاني",
];

export function TransplantPanel() {
  const { toast } = useToast();
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [srcFaces, setSrcFaces] = useState<FaceBox[]>([]);
  const [srcIdx, setSrcIdx] = useState<number | null>(null);

  // عدة صور مرجعية + المرجع النشط + المربعات المرقمة
  type RefEntry = { preview: string; path: string; faces: FaceBox[] };
  const [refs, setRefs] = useState<RefEntry[]>([]);
  const [activeRef, setActiveRef] = useState(0);
  const [refIdx, setRefIdx] = useState<number | null>(null);
  const [detecting, setDetecting] = useState(false);
  const refEntry: RefEntry | null = refs[activeRef] ?? null;
  const refPreview = refEntry?.preview ?? null;
  const refPath = refEntry?.path ?? null;
  const [mode, setMode] = useState<Mode>("head");
  const [region, setRegion] = useState<Region>("full");
  const [scale, setScale] = useState(1.0);
  const [colorStrength, setColorStrength] = useState(0.6);
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  // تاريخ النتائج — أساس زرّي التراجع والتقدّم + نسبة الزوم
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const histIdxRef = useRef(-1);
  const [zoom, setZoom] = useState(1);
  const resultBoxRef = useRef<HTMLDivElement>(null);

  const pushResult = (url: string) => {
    const nh = [...history.slice(0, histIdxRef.current + 1), url].slice(-20);
    histIdxRef.current = nh.length - 1;
    setHistory(nh);
    setHistIdx(histIdxRef.current);
    setResultUrl(url);
    setZoom(1);
  };
  const undoResult = () => {
    if (histIdxRef.current > 0) {
      histIdxRef.current -= 1;
      setHistIdx(histIdxRef.current);
      setResultUrl(history[histIdxRef.current]);
      setZoom(1);
    }
  };
  const redoResult = () => {
    if (histIdxRef.current < history.length - 1) {
      histIdxRef.current += 1;
      setHistIdx(histIdxRef.current);
      setResultUrl(history[histIdxRef.current]);
      setZoom(1);
    }
  };

  // زوم النتيجة بعجلة الفأرة — نفس سلوك صفحة تبديل الوجوه (1%–5000%)
  useEffect(() => {
    const el = resultBoxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(50, Math.max(0.01, z * (e.deltaY > 0 ? 0.9 : 1.1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [resultUrl]);

  // تحديد المكان (معاينة تكرارية قبل التنفيذ)
  const [sel, setSel] = useState<Selection | null>(null);
  const [selBusy, setSelBusy] = useState(false);

  // agent state
  const [chat, setChat] = useState<ChatMsg[]>([
    { role: "agent", text: "أنا مساعد النقل الذكي 🤖 — ارفع صورة المصدر وصورة أو أكثر من المراجع، وستظهر مربعات مرقمة على كل صورة: اضغط رقم الشخص الذي تريد تعديله في المصدر ورقم الشخص الذي ستؤخذ منه في المرجع (أو اكتب «الشخص الثاني»).\nثم اكتب المكان (مثال: «الرأس» أو «الشعر») ليظهر التحديد الأخضر، وعدّل كتابتك حتى يصبح صحيحاً، واضغط «نقل الآن».\nللتنقل بين المراجع: اضغط الصورة المصغرة أو اكتب «المرجع الثاني»." },
  ]);
  const [input, setInput] = useState("");
  const [voiceOn, setVoiceOn] = useState(true);
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ sourcePath: null as string | null, refPath: null as string | null });
  stateRef.current = { sourcePath, refPath };

  const speak = (text: string) => {
    if (!voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[🤖🎤✓👌…•]/g, ""));
      u.lang = "ar-SA";
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    } catch { /* TTS unsupported — silent */ }
  };

  const pushMsg = (m: ChatMsg) => {
    setChat(c => [...c, m]);
    // تمرير صندوق الدردشة فقط — NOT scrollIntoView الذي كان يحرّك الصفحة
    // كلها ويجعل الواجهة تقفز للأعلى/الأسفل عند كل رفع صورة
    setTimeout(() => {
      const el = chatBoxRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 60);
  };

  /** كشف الوجوه وترقيمها على صورة مرفوعة — أساس المربعات المرقمة */
  const runDetect = async (path: string, apply: (f: FaceBox[]) => void, label = "") => {
    setDetecting(true);
    try {
      const r = await fetch("/api/images/face-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: path }),
        signal: AbortSignal.timeout(90_000),
      });
      const d = await r.json().catch(() => ({}));
      const f: FaceBox[] = d?.ok && Array.isArray(d.faces) ? d.faces : [];
      apply(f);
      if (f.length) {
        const n = f.length === 1 ? "شخصاً واحداً" : `${f.length} أشخاص`;
        pushMsg({
          role: "agent",
          text: `${label ? `صورة ${label}` : "الصورة"}: وجدت ${n} — اضغط المربع المرقم على الصورة لاختيار الشخص، أو اكتب «الشخص الثاني».`,
        });
      }
    } catch { /* الكشف اختياري — لا نعطل الرفع */ } finally {
      setDetecting(false);
    }
  };

  const pickImage = async (kind: "source" | "ref", file: File) => {
    // ثبات الصفحة: نحفظ موضع التمرير ونعيده بعد اكتمال الرفع —
    // رفع الصورة يجب ألا يحرّك الصفحة إطلاقاً
    const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
    const restoreScroll = () => {
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
      setTimeout(() => window.scrollTo(0, scrollY), 350);
    };
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const fd = new FormData();
      fd.append("file", blob, `transplant-${kind}.png`);
      const up = await fetch("/api/images/upload", { method: "POST", body: fd });
      const data = await up.json();
      if (!up.ok || !data.url) throw new Error(data.error || "فشل الرفع");
      setResultUrl(null);
      setSel(null);   // الصورة تغيرت — التحديد القديم لم يعد صالحاً
      if (kind === "source") {
        setSourcePreview(dataUrl);
        setSourcePath(data.url);
        setSrcFaces([]); setSrcIdx(null);
        runDetect(data.url, (f) => setSrcFaces(f), "المصدر");
      } else {
        // عدة مراجع: الإضافة للقائمة والتفعيل الفوري للمرجع الجديد
        const entry: RefEntry = { preview: dataUrl, path: data.url, faces: [] };
        setRefs((rs) => [...rs, entry]);
        setActiveRef(refs.length);
        setRefIdx(null);
        runDetect(
          data.url,
          (f) => setRefs((cur) => cur.map((e) => (e.path === data.url ? { ...e, faces: f } : e))),
          "المرجع",
        );
      }
    } catch (e: any) {
      toast({ title: "فشل رفع الصورة", description: e?.message || String(e), variant: "destructive" });
    } finally {
      restoreScroll();
    }
  };

  const clearImage = (kind: "source" | "ref") => {
    if (kind === "source") {
      setSourcePreview(null); setSourcePath(null);
      setSrcFaces([]); setSrcIdx(null);
    } else {
      setRefs((rs) => rs.filter((_, i) => i !== activeRef));
      setActiveRef(0);
      setRefIdx(null);
    }
    setResultUrl(null);
    setSel(null);
  };

  /** إزالة مرجع محدد من قائمة المراجع */
  const removeRef = (i: number) => {
    setRefs((rs) => rs.filter((_, k) => k !== i));
    setActiveRef((a) => (i < a ? a - 1 : i === a ? 0 : a));
    setRefIdx(null);
    setSel(null);
  };

  // تحسين الجودة (نفس مسار صفحة تبديل الوجه) — المصدر: يستبدل الصورة بعد التحسين
  const enhanceSource = (r: EnhancedResult) => {
    setSourcePreview(r.url);
    setSourcePath(r.url);
  };
  // تحسين المرجع النشط: تحدّث صورته في قائمة المراجع — القناع القديم لم يعد صالحاً
  const enhanceRef = (r: EnhancedResult) => {
    setRefs((rs) => rs.map((e, i) => (i === activeRef ? { ...e, preview: r.url, path: r.url } : e)));
    setSel(null);
  };

  const execute = async (opts: {
    mode: Mode; region: Region; scale?: number; colorStrength?: number;
  }, announce?: string): Promise<boolean> => {
    const sp = stateRef.current.sourcePath;
    const rp = stateRef.current.refPath;
    if (!sp || !rp) {
      pushMsg({ role: "agent", text: "ارفع أولاً صورة المصدر وصورة المرجع فوق ☝️ ثم أعِد الأمر." });
      speak("ارفع أولا صورة المصدر وصورة المرجع");
      return false;
    }
    setBusy(true);
    setResultUrl(null);
    try {
      const r = await fetch("/api/images/part-transplant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: sp,
          refPath: rp,
          mode: opts.mode,
          region: opts.region,
          scale: opts.scale ?? scale,
          colorStrength: opts.colorStrength ?? colorStrength,
          ...(srcIdx != null ? { sourceIndex: srcIdx } : {}),
          ...(refIdx != null ? { faceIndex: refIdx } : {}),
        }),
        signal: AbortSignal.timeout(150_000),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) throw new Error(data.error || data.message || `HTTP ${r.status}`);
      pushResult(data.url);
      if (opts.mode) { setMode(opts.mode); setRegion(opts.region); }
      if (opts.scale) setScale(opts.scale);
      if (opts.colorStrength) setColorStrength(opts.colorStrength);
      pushMsg({ role: "agent", text: `تم التنفيذ ✓ — ${announce || "الدمج جاهز"} يمكنك التنزيل أو تجربة أمر آخر.` });
      speak("تم التنفيذ بنجاح");
      return true;
    } catch (e: any) {
      pushMsg({ role: "agent", text: `تعذر التنفيذ: ${e?.message || e}` });
      speak("تعذر التنفيذ، حاول مرة أخرى");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const run = () => { if (sel) executeSelection(); else execute({ mode, region }); };

  /** طلب تحديد مكان بالنص — يعيد عرض التحديد الأخضر على صورة المرجع */
  const requestSelection = async (text: string, prevSpec?: any) => {
    const rp = stateRef.current.refPath;
    if (!rp) {
      pushMsg({ role: "agent", text: "ارفع أولاً صورة المصدر وصورة المرجع فوق ☝️ ثم اكتب المكان." });
      speak("ارفع أولا صورة المصدر وصورة المرجع");
      return;
    }
    setSelBusy(true);
    pushMsg({ role: "agent", text: "أبحث عن المكان وأعرض التحديد…" });
    try {
      const r = await fetch("/api/images/part-transplant/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, refPath: rp, side: "ref", ...(refIdx != null ? { faceIndex: refIdx } : {}), ...(prevSpec ? { prevSpec } : {}) }),
        signal: AbortSignal.timeout(120_000),
      });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        setSel({ side: "ref", overlay: d.overlay, mask: d.mask, label: d.label, spec: d.spec, areaPct: d.areaPct });
        pushMsg({
          role: "agent",
          text:
            `حددت: ${d.label} — ظهر باللون الأخضر على صورة المرجع` +
            (d.areaPct != null ? ` (${d.areaPct}% من الصورة)` : "") +
            `.\nالتحديد صحيح؟ اضغط «نقل الآن» ✅\n` +
            `التحديد خطأ؟ عدّل كتابتك وسيظهر التحديد الجديد — أمثلة: «الشعر فقط»، «بدون الوجه»، «الجهة اليسرى»، «كبّر التحديد».`,
        });
        speak("ظهر التحديد. اضغط نقل الآن إذا كان صحيحا أو عدل كتابتك");
      } else {
        const hints: string[] = d.hint || [];
        pushMsg({
          role: "agent",
          text: `${d.error || "لم أفهم المكان."}${hints.length ? "\nجرّب: " + hints.slice(0, 6).join("، ") : ""}`,
        });
        speak("لم افهم المكان. عدل الكتابة");
      }
    } catch (e: any) {
      pushMsg({ role: "agent", text: `تعذر التحديد: ${e?.message || e}` });
    } finally {
      setSelBusy(false);
    }
  };

  /** تنفيذ النقل بالتحديد المعتمد (القناع الظاهر على الصورة) */
  const executeSelection = async (): Promise<boolean> => {
    const current = sel;
    if (!current) return false;
    const sp = stateRef.current.sourcePath;
    const rp = stateRef.current.refPath;
    if (!sp || !rp) {
      pushMsg({ role: "agent", text: "ارفع صورة المصدر وصورة المرجع أولاً ☝️" });
      return false;
    }
    setBusy(true);
    setResultUrl(null);
    try {
      const r = await fetch("/api/images/part-transplant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: sp,
          refPath: rp,
          mode: "custom",
          refMask: current.mask,
          refSpec: current.spec,
          edited: !!current.edited,
          scale,
          colorStrength,
          ...(srcIdx != null ? { sourceIndex: srcIdx } : {}),
          ...(refIdx != null ? { faceIndex: refIdx } : {}),
        }),
        signal: AbortSignal.timeout(150_000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || d.message || `HTTP ${r.status}`);
      pushResult(d.url);
      pushMsg({ role: "agent", text: `تم النقل والدمج ✓ — ${current.label}. النتيجة ظاهرة تحت — يمكنك تعديل التحديد وإعادة النقل أو التراجع/التقدّم بين النتائج.` });
      speak("تم النقل بنجاح");
      return true;
    } catch (e: any) {
      pushMsg({ role: "agent", text: `تعذر النقل: ${e?.message || e}` });
      speak("تعذر النقل حاول مرة اخرى");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCommand = async (raw: string) => {
    const text = raw.trim();
    if (!text || selBusy) return;
    pushMsg({ role: "user", text });
    setInput("");
    const norm = text.replace(/[إأآا]/g, "ا").replace(/[ًٌٍَُِّْ]/g, "").replace(/\s+/g, " ").toLowerCase();

    // تنفيذ التحديد الحالي (كلمات تأكيد صرفة فقط)
    if (/^(نقل الان|نفذ|نفذ الان|ابدا|تم|موافق|تمام|نعم|اوك|اوكي|ok|يلا|اعملها)/.test(norm) && sel) {
      await executeSelection();
      return;
    }
    // إلغاء التحديد
    if (/(الغاء|الغي|امسح|ازل|شيل) ?(التحديد)?/.test(norm) && sel) {
      setSel(null);
      pushMsg({ role: "agent", text: "ألغيت التحديد ✓ — اكتب المكان من جديد أو استخدم الأزرار السريعة." });
      return;
    }
    // تعديل التحديد الحالي (تكبير/تصغير/استثناء) — قبل تعديل الحجم العام
    if (sel && /تحديد/.test(norm) && (/كبر|وسع|صغر|ضيق|بدون|غير |استثني|استبعد/.test(norm))) {
      await requestSelection(text, sel.spec);
      return;
    }
    // استثناء جزء من التحديد الحالي («بدون الوجه»)
    if (sel && /بدون|استثني|استبعد/.test(norm)) {
      await requestSelection(text, sel.spec);
      return;
    }
    // تعديل الحجم
    const pct = norm.match(/(\d{1,3})\s*%/);
    if (pct && /كبر|صغر|زود|قلل|نقص/.test(norm)) {
      const v = Number(pct[1]);
      const s = /صغر|قلل|نقص/.test(norm) ? 1 - v / 100 : 1 + v / 100;
      const sv = Math.max(0.3, Math.min(2, s));
      setScale(sv);
      pushMsg({ role: "agent", text: `تم ضبط الحجم إلى ${Math.round(sv * 100)}% ✓` });
      return;
    }
    // تعديل توحيد الألوان
    if (/لون|بشره|اضاءه|ظل/.test(norm) && /زود|اكثر|قوي|عالي|قلل|اقل|خفف/.test(norm)) {
      const up = /زود|اكثر|قوي|عالي/.test(norm);
      setColorStrength(up ? 0.85 : 0.35);
      pushMsg({ role: "agent", text: up ? "زودت توحيد البشرة والإضاءة ✓" : "خففت توحيد البشرة والإضاءة ✓" });
      return;
    }

    // ---- المربعات المرقمة: أوامر اختيار شخص / تبديل مرجع ----
    const REGION_HINT = /راس|وجه|شعر|عين|انف|فم|صدر|جذع|بطن|ذراع|رجل|ساق|خلفيه|ملابس|قط|كائن|حيوان|نصف|تحديد/;
    const AR_ORD: Record<string, number> = {
      "اول": 0, "اولى": 0, "ثاني": 1, "ثانيه": 1, "ثالث": 2, "ثالثه": 2,
      "رابع": 3, "خامس": 4, "سادس": 5, "سابع": 6, "ثامن": 7, "تاسع": 8, "عاشر": 9,
    };
    // تبديل المرجع النشط: «المرجع الثاني» / «ريفرنس رقم 2»
    const refSw = norm.match(/(?:مرجع|ريفرنس|المرجعيه|المرجعية)\s*(?:رقم\s*)?(الاول|الثاني|الثالث|الرابع|الخامس|\d+)/);
    if (refSw && !REGION_HINT.test(norm)) {
      const t = refSw[1];
      const i = /^\d+$/.test(t) ? Number(t) - 1 : (AR_ORD[t.replace(/^ال/, "")] ?? -1);
      if (i >= 0 && i < refs.length) {
        setActiveRef(i);
        setRefIdx(null);
        setSel(null);
        pushMsg({ role: "agent", text: `انتقلت إلى المرجع ${i + 1} من ${refs.length} ✓ — التحديد الآن على هذه الصورة.` });
        return;
      }
    }
    // اختيار شخص برقمه: «الشخص الثاني» / «خذ شخص رقم 3» / «المصدر الشخص الأول»
    if (!REGION_HINT.test(norm) && /شخص|وجه/.test(norm)) {
      const m = norm.match(/(?:شخص|وجه)\s*(?:رقم\s*)?(الاول|الاولى|الثاني|الثانيه|الثالث|الثالثه|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)?/);
      let i = -1;
      if (m && m[1]) {
        i = /^\d+$/.test(m[1]) ? Number(m[1]) - 1 : (AR_ORD[m[1].replace(/^ال/, "")] ?? -1);
      }
      if (i >= 0) {
        const onSource = /مصدر/.test(norm);
        const faces = onSource ? srcFaces : (refEntry?.faces ?? []);
        if (!faces.length) {
          pushMsg({ role: "agent", text: onSource ? "لم أكتشف أشخاصاً في صورة المصدر بعد — تأكد من رفعها أو انتظر الكشف." : "لم أكتشف أشخاصاً في صورة المرجع بعد — تأكد من رفعها أو انتظر الكشف." });
          return;
        }
        if (i >= faces.length) {
          pushMsg({ role: "agent", text: `في هذه الصورة ${faces.length === 1 ? "شخص واحد فقط" : `${faces.length} أشخاص فقط`} — اختر رقماً من 1 إلى ${faces.length}.` });
          return;
        }
        if (onSource) {
          setSrcIdx(i);
          pushMsg({ role: "agent", text: `اخترت الشخص ${i + 1} في صورة المصدر ✓ — سيتم التعديل عليه.` });
        } else {
          setRefIdx(i);
          pushMsg({ role: "agent", text: `اخترت الشخص ${i + 1} في صورة المرجع ✓ — الآن اكتب الجزء (مثل: «الشعر») وسأحدده من هذا الشخص.` });
        }
        return;
      }
    }

    // طلب تحديد مكان → معاينة تكرارية
    await requestSelection(text);
  };

  const toggleMic = () => {
    const W = window as any;
    const SR = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!SR) {
      toast({ title: "المايك غير مدعوم", description: "استخدم Chrome أو Edge للإدخال الصوتي.", variant: "destructive" });
      return;
    }
    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = "ar-SA";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev: any) => {
      const said = ev.results?.[0]?.[0]?.transcript || "";
      if (said) handleCommand(said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recogRef.current = rec;
    rec.start();
    setListening(true);
  };

  const activeMode = MODES.find(m => m.key === mode)!;

  return (
    <div className="flex flex-col gap-4 p-4 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
          <Wand2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold">نقل الأجزاء بين الصور + المساعد الذكي بالتحديد المرئي</h2>
          <p className="text-xs text-muted-foreground">
            المربعات المرقمة على الصورتين تحدد أي شخص سيتم التعديل عليه، مع دعم أكثر من مرجع. اكتب المكان في الدردشة (مثال: «الرأس») ليظهر التحديد بالأخضر — عدّل كتابتك حتى يصبح التحديد صحيحاً ثم اضغط «نقل الآن». الدمج يحافظ على البشرة والإضاءة وحجم الرأس دون تمييز جزء عن جزء.
          </p>
        </div>
      </div>

      {/* Uploads */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DropSlot
          title="صورة المصدر"
          subtitle="الصورة الأساسية التي سيتم الدمج عليها — اضغط رقم الشخص لاختياره"
          preview={sourcePreview}
          onPick={(f) => pickImage("source", f)}
          onClear={() => clearImage("source")}
          accent="bg-cyan-500"
          faces={srcFaces}
          selectedFace={srcIdx}
          tone="cyan"
          onPickFace={(i) => setSrcIdx((v) => (v === i ? null : i))}
          footer={sourcePreview && sourcePath ? (
            <>
              <ActionBar url={sourcePath} label="transplant-source" />
              <EnhanceQualityButtons
                sourcePath={sourcePath}
                onEnhanced={enhanceSource}
                variant="compact"
              />
            </>
          ) : null}
        />
        {sel?.side === "ref" && refPreview ? (
          <MaskEditor
            imageSrc={refPreview}
            maskSrc={sel.mask}
            label={sel.label}
            onChange={(maskDataUrl) =>
              setSel((s) => (s ? { ...s, mask: maskDataUrl, edited: true } : s))
            }
            onCancel={() => setSel(null)}
          />
        ) : (
          <DropSlot
            title={refs.length > 1 ? `صورة المرجع (${activeRef + 1}/${refs.length})` : "صورة المرجع"}
            subtitle="الصورة التي سيؤخذ منها الجزء — يمكنك إضافة أكثر من مرجع"
            preview={refPreview}
            onPick={(f) => pickImage("ref", f)}
            onClear={() => clearImage("ref")}
            accent="bg-fuchsia-500"
            overlayUrl={sel?.side === "ref" ? sel.overlay : null}
            selectionLabel={sel?.side === "ref" ? sel.label : null}
            onClearSelection={() => setSel(null)}
            faces={refEntry?.faces ?? []}
            selectedFace={refIdx}
            tone="fuchsia"
            onPickFace={(i) => setRefIdx((v) => (v === i ? null : i))}
            footer={refPreview && refPath && !sel ? (
              <>
                <ActionBar url={refPath} label="transplant-ref" />
                <EnhanceQualityButtons
                  sourcePath={refPath}
                  onEnhanced={enhanceRef}
                  variant="compact"
                />
              </>
            ) : null}
          />
        )}
      </div>

      {/* شريط المراجع المتعددة */}
      {refs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground">
            صور المرجع ({refs.length}) — اضغط لتفعيل:
          </span>
          {refs.map((rf, i) => (
            <div key={rf.path} className="relative group">
              <button
                type="button"
                title={`المرجع ${i + 1}`}
                onClick={() => { if (i !== activeRef) { setActiveRef(i); setRefIdx(null); setSel(null); } }}
                className={`w-14 h-14 rounded-md overflow-hidden border-2 transition-all ${
                  i === activeRef ? "border-fuchsia-500 ring-2 ring-fuchsia-400/40" : "border-border opacity-70 hover:opacity-100"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={rf.preview} alt={`مرجع ${i + 1}`} className="w-full h-full object-cover" />
              </button>
              <span className="absolute bottom-0 end-0 bg-black/70 text-white text-[9px] px-1 rounded-tl">{i + 1}</span>
              <button
                type="button"
                title="إزالة هذا المرجع"
                onClick={() => removeRef(i)}
                className="absolute -top-1.5 -end-1.5 w-5 h-5 rounded-full bg-destructive text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Mode selector */}
      <Card className="p-3">
        <div className="text-sm font-semibold mb-2">ماذا تريد نقل؟ (يدوياً)</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {MODES.map(m => (
            <button
              key={m.key}
              type="button"
              onClick={() => { setMode(m.key); setRegion("full"); }}
              className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-colors ${
                mode === m.key ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/50"
              }`}
            >
              <m.icon className="w-5 h-5" />
              <span className="text-xs font-semibold">{m.label}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2 leading-5">{activeMode.hint}</p>
      </Card>

      {/* Fine-tuning */}
      <Card className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold flex items-center gap-2">
            <User2 className="w-3.5 h-3.5" />
            ضبط الحجم: <span className="text-primary font-mono">{scale.toFixed(2)}×</span>
          </span>
          <input type="range" min={0.5} max={1.6} step={0.05} value={scale}
            onChange={(e) => setScale(Number(e.target.value))} className="accent-primary" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold flex items-center gap-2">
            <Wand2 className="w-3.5 h-3.5" />
            توحيد البشرة والإضاءة: <span className="text-primary font-mono">{Math.round(colorStrength * 100)}%</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={colorStrength}
            onChange={(e) => setColorStrength(Number(e.target.value))} className="accent-primary" />
        </label>
      </Card>

      <Button size="lg" className="w-full text-base font-bold" disabled={busy || selBusy || !sourcePath || !refPath} onClick={run}>
        {busy ? "جارٍ النقل والدمج…" : sel ? `نقل الجزء المحدد (${sel.label})` : "ابدأ النقل الآن"}
      </Button>

      {detecting && <ProgressIndicator busy label="أكتشف الأشخاص وأرقّمهم على الصور…" />}
      {selBusy && <ProgressIndicator busy={selBusy} label="أبحث عن المكان المطلوب وأبني التحديد…" />}
      {!selBusy && busy && <ProgressIndicator busy={busy} label="جارٍ استخراج الجزء ومطابقة الألوان والإضاءة…" />}

      {/* Agent chat */}
      <Card className="p-3 flex flex-col gap-2 border-primary/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Bot className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <div className="text-sm font-bold">المساعد الذكي — اكتب المكان وسيظهر التحديد</div>
              <div className="text-[10px] text-muted-foreground">«الرأس» / «الشعر» / «الخلفية» / «الشخص الثاني» / «المرجع الثاني» / «بدون الوجه» / «كبّر التحديد» — عدّل كتابتك حتى يصبح التحديد صحيحاً</div>
            </div>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={voiceOn ? "كتم صوت الردود" : "تشغيل صوت الردود"} onClick={() => setVoiceOn(v => !v)}>
              {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant={listening ? "destructive" : "outline"} className="h-8" onClick={toggleMic} title="تحدث الآن">
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span className="text-xs ms-1">{listening ? "أستمع…" : "مايك"}</span>
            </Button>
          </div>
        </div>

        <div ref={chatBoxRef} className="max-h-56 overflow-y-auto flex flex-col gap-1.5 p-2 rounded-md bg-muted/30">
          {chat.map((m, i) => (
            <div key={i} className={`text-xs leading-5 whitespace-pre-line rounded-lg px-2.5 py-1.5 max-w-[85%] ${
              m.role === "user" ? "self-end bg-primary/15 text-foreground" : "self-start bg-card border border-border/60"
            }`}>
              {m.text}
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCommand(input); }}
            placeholder="اكتب المكان… مثال: الشعر — أو أكّد بنقل الآن"
            className="flex-1 h-9 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button size="sm" className="h-9 px-3" onClick={() => handleCommand(input)} disabled={!input.trim() || selBusy}>
            <Send className="w-4 h-4" />
          </Button>
          {sel && (
            <Button size="sm" className="h-9 px-3 font-bold" onClick={() => executeSelection()} disabled={busy}>
              نقل الآن
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SEL_CHIPS.map(s => (
            <button key={s} type="button" onClick={() => handleCommand(s)} disabled={selBusy}
              className="text-[11px] rounded-full border border-border px-2.5 py-1 hover:border-primary/60 hover:text-primary transition-colors disabled:opacity-50">
              {s}
            </button>
          ))}
          <button type="button" onClick={() => handleCommand("كبّر التحديد")} disabled={selBusy}
            className="text-[11px] rounded-full border border-border px-2.5 py-1 hover:border-primary/60 hover:text-primary transition-colors disabled:opacity-50">
            كبّر التحديد
          </button>
        </div>
      </Card>

      {/* Result — إغلاق + تراجع/تقدّم + زوم مثل باقي الصفحات */}
      {resultUrl && (
        <Card className="overflow-hidden">
          <div className="p-2 flex items-center justify-between border-b border-border/50">
            <span className="text-sm font-semibold">
              النتيجة{history.length > 1 ? ` (${histIdx + 1}/${history.length})` : ""}
            </span>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="إغلاق النتيجة" onClick={() => setResultUrl(null)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border/50 bg-card/60 flex-wrap">
            <Button size="sm" variant="outline" className="h-8" disabled={histIdx <= 0} onClick={undoResult} title="التراجع عن النتيجة">
              <Undo2 className="w-3.5 h-3.5" />
              <span className="text-xs">تراجع</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={histIdx >= history.length - 1} onClick={redoResult} title="التقدّم للنتيجة الأحدث">
              <Redo2 className="w-3.5 h-3.5" />
              <span className="text-xs">تقدّم</span>
            </Button>
            <span className="mx-1 h-5 w-px bg-border/60" />
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={zoom <= 0.011} onClick={() => setZoom((z) => Math.max(0.01, z * 0.8))} title="تصغير">
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={zoom >= 50} onClick={() => setZoom((z) => Math.min(50, z * 1.25))} title="تكبير">
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={zoom === 1} onClick={() => setZoom(1)} title="إعادة الضبط">
              <RotateCw className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
          </div>
          <div
            ref={resultBoxRef}
            className="bg-neutral-950 overflow-auto"
            style={{ maxHeight: "65vh", cursor: zoom > 1 ? "grab" : "default" }}
          >
            <div className="flex items-center justify-center min-h-full" style={{ width: `${zoom * 100}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultUrl}
                alt="نتيجة نقل الجزء"
                className="w-full h-auto object-contain select-none"
                style={{ transition: "width 0.15s ease-out" }}
                draggable={false}
              />
            </div>
          </div>
          <ActionBar url={resultUrl} label="part-transplant" />
          {/* 5-level Enhance Quality buttons — نفس مسار صفحة تبديل الوجه */}
          <EnhanceQualityButtons
            sourcePath={resultUrl}
            onEnhanced={(r) => pushResult(r.url)}
            variant="compact"
            className="px-2 pt-2"
          />
        </Card>
      )}
    </div>
  );
}
