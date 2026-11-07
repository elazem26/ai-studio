"use client";

/**
 * AiVideoGeneratorCard — وكيل «توليد فيديو من الصور» في صفحة أدوات الفيديو.
 *
 * نفس فكرة وكيل الصور: ارفع صور أشخاصك (+ مرجع أو شخصية تذكرها بالاسم)
 * واكتب الفكرة ← يبني الوكيل صورة المشهد بقفل الملامح ← يحرّكها فيديو.
 *
 * التحكم الكامل: الجودة (سرعة/عالية)، المدة (5/10ث)، حجم العرض، الكادر،
 * الصيغة (MP4/WebM/GIF)، طريقة العرض (سينمائي/واقعي/دافئ/أبيض وأسود)،
 * والصوت: صوت المحرك الأصلي + تعليق صوتي (لغة/لهجة/سرعة) + موسيقى خلفية.
 *
 * تحت المربع: تحسين الجودة، حفظ، طباعة الملصق، تقدم، رجوع، زوم− إلى 0
 * (إظهار كامل الفيديو دائمًا)، زوم+ للحد الأقصى.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Loader2, Film, Sparkles, Download, Printer, Undo2, Redo2, ZoomIn, ZoomOut,
  UploadCloud, X, Plus, AlertTriangle, CheckCircle2, Music, Mic, Users,
} from "lucide-react";

interface VideoResult {
  url: string;
  path: string;
  format: string;
  width: number;
  height: number;
  duration: number;
  sizeMB: number;
  style: string;
  method: string;
  locked: number;
  lockNote: string;
  narrationScript?: string;
  narrationNote?: string;
  sceneUrl?: string;
  posterUrl?: string;
  degraded?: string;
}

const PHASE_LABELS: Record<string, string> = {
  understand: "الفهم",
  analyze: "التحليل والتخطيط",
  apply: "بناء المشهد وقفل الملامح وتوليد الفيديو",
  finalizing: "الصوت والتغليف",
  done: "اكتمل",
};

const STYLE_OPTIONS = [
  { value: "cinematic", label: "سينمائي" },
  { value: "realistic", label: "واقعي" },
  { value: "warm", label: "دافئ" },
  { value: "bw", label: "أبيض وأسود" },
];

const SIZE_OPTIONS = [
  { value: "1280x720", label: "أفقي HD — 1280×720" },
  { value: "1920x1080", label: "أفقي FHD — 1920×1080" },
  { value: "720x1280", label: "ستوري — 720×1280" },
  { value: "1080x1920", label: "ستوري FHD — 1080×1920" },
  { value: "1024x1024", label: "مربع — 1024×1024" },
];

const LANG_OPTIONS = [
  { value: "ar-MSA", label: "عربي فصحى" },
  { value: "ar-EG", label: "عربي مصري" },
  { value: "ar-GULF", label: "عربي خليجي" },
  { value: "en", label: "إنجليزي" },
];

const MUSIC_OPTIONS = [
  { value: "none", label: "بدون موسيقى" },
  { value: "ambient", label: "هادئة" },
  { value: "upbeat", label: "مبهجة" },
];

const MAX_IMAGES = 4;

export function AiVideoGeneratorCard({ isAr }: { isAr: boolean }) {
  const t = (ar: string, en: string) => (isAr ? ar : en);

  // ----- صور الأشخاص -----
  const [images, setImages] = useState<{ path: string; url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ----- الخيارات -----
  const [prompt, setPrompt] = useState("");
  const [quality, setQuality] = useState<"speed" | "quality">("speed");
  const [durationSec, setDurationSec] = useState<5 | 10>(5);
  const [videoSize, setVideoSize] = useState("1280x720");
  const [fps, setFps] = useState<24 | 30>(30);
  const [format, setFormat] = useState<"mp4" | "webm" | "gif">("mp4");
  const [style, setStyle] = useState("cinematic");
  const [nativeAudio, setNativeAudio] = useState(false);
  const [narrationOn, setNarrationOn] = useState(false);
  const [narrationScript, setNarrationScript] = useState("");
  const [lang, setLang] = useState("ar-MSA");
  const [speed, setSpeed] = useState("1");
  const [music, setMusic] = useState("ambient");

  // ----- المهمة -----
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  // ----- النتيجة + التاريخ (رجوع/تقدم) -----
  const [history, setHistory] = useState<VideoResult[]>([]);
  const [idx, setIdx] = useState(-1);
  const result = idx >= 0 ? history[idx] : null;

  // ----- الزوم -----
  const [zoom, setZoom] = useState(0); // 0 = الفيديو كامل داخل المربع
  const scale = 1 + (zoom / 100) * 1.5;

  useEffect(() => {
    if (!taskId || !busy) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/task/status?id=${taskId}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (cancelled) return;
        if (d.phase) setPhase(d.phase);
        if (typeof d.progress === "number") setProgress(d.progress);
        if (d.status === "done") {
          setBusy(false);
          setPhase("done");
          setTaskId(null);
          const res = d.result as VideoResult;
          setHistory((h) => [...h.slice(0, 50), res]);
          setIdx((i) => i + 1);
          toast.success(t("🎬 جاهز! تم توليد الفيديو", "🎬 Video ready"));
        } else if (d.status === "error") {
          setBusy(false);
          setTaskId(null);
          setError(d.error || t("فشل التوليد", "Generation failed"));
        }
      } catch {
        /* استمرار المتابعة */
      }
    };
    const timer = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [taskId, busy, isAr, t]);

  // ----- رفع صور الأشخاص -----
  const upload = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) {
        toast.error(t("اختر ملف صورة صالحًا", "Pick a valid image file"));
        return;
      }
      setUploading(true);
      try {
        for (const file of imgs) {
          if (images.length >= MAX_IMAGES) {
            toast.error(t(`الحد الأقصى ${MAX_IMAGES} صور`, `Max ${MAX_IMAGES} images`));
            break;
          }
          const fd = new FormData();
          fd.append("file", file);
          const r = await fetch("/api/images/upload", { method: "POST", body: fd });
          const d = await r.json();
          if (!r.ok) throw new Error(d?.error ?? "فشل الرفع");
          setImages((prev) => [...prev, { path: d.path, url: d.url, name: d.name }]);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "فشل الرفع");
      } finally {
        setUploading(false);
      }
    },
    [images.length, isAr, t]
  );

  // ----- بدء التوليد -----
  const start = useCallback(async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    setPhase("understand");
    setProgress(3);
    try {
      const r = await fetch("/api/video/compose-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imagePaths: images.map((i) => i.path),
          instruction: prompt.trim(),
          videoSize,
          quality,
          durationSec,
          fps,
          format,
          style,
          lockFaces: true,
          audio: {
            native: nativeAudio,
            narration: { enabled: narrationOn, script: narrationScript, lang, speed: Number(speed) || 1 },
            music,
          },
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "تعذر بدء المهمة");
      setTaskId(d.taskId);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : "خطأ غير معروف");
    }
  }, [prompt, busy, images, videoSize, quality, durationSec, fps, format, style, nativeAudio, narrationOn, narrationScript, lang, speed, music]);

  // ----- الأدوات -----
  const save = useCallback(async () => {
    if (!result) return;
    try {
      const r = await fetch(result.url);
      const b = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `compose-video-${Date.now()}.${result.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      toast.error(t("تعذر الحفظ", "Save failed"));
    }
  }, [result, isAr, t]);

  const printPoster = useCallback(() => {
    if (!result) return;
    try {
      const src = result.posterUrl || result.sceneUrl || result.url;
      const f = document.createElement("iframe");
      f.style.cssText = "position:fixed;right:-10000px;bottom:0;width:800px;height:600px;border:0;";
      document.body.appendChild(f);
      const doc = f.contentWindow?.document;
      if (!doc) return;
      doc.open();
      doc.write(
        `<!doctype html><html dir="rtl"><head><title>طباعة</title></head>` +
          `<body style="margin:0;display:flex;align-items:center;justify-content:center;">` +
          `<img src="${src}" style="max-width:100%;max-height:96vh;object-fit:contain" ` +
          `onload="window.focus();window.print();"></body></html>`
      );
      doc.close();
      setTimeout(() => f.remove(), 60000);
    } catch {
      toast.error(t("تعذر بدء الطباعة", "Print failed"));
    }
  }, [result]);

  const enhance = useCallback(async () => {
    if (!result || busy) return;
    setBusy(true);
    setError("");
    setPhase("finalizing");
    setProgress(30);
    try {
      toast.info(t("جارٍ تحسين جودة الفيديو…", "Enhancing video quality…"));
      const blob = await (await fetch(result.url)).blob();
      const fd = new FormData();
      fd.append("file", blob, `enhance-${Date.now()}.${result.format}`);
      const r = await fetch(`/api/video/enhance?filename=${encodeURIComponent(`enhanced-${Date.now()}.${result.format}`)}&quality=fullHd&size=${blob.size}`, {
        method: "POST",
        body: fd,
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error ?? d?.message ?? "فشل التحسين");
      const newUrl = d?.url ?? d?.result?.url;
      if (!newUrl) throw new Error("لم تصل نتيجة التحسين");
      setHistory((h) => [
        ...h,
        { ...result, url: newUrl, sizeMB: d?.sizeMB ?? result.sizeMB, lockNote: "تم تحسين الجودة ✓" },
      ]);
      setIdx((i) => i + 1);
      toast.success(t("تم تحسين الجودة ✓", "Quality enhanced ✓"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التحسين");
    } finally {
      setBusy(false);
      setPhase("");
      setProgress(0);
    }
  }, [result, busy, isAr, t]);

  const canUndo = idx > 0;
  const canRedo = idx < history.length - 1;

  return (
    <Card className="studio-panel border-cyan-accent/40">
      <CardHeader className="py-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Film className="h-4 w-4 text-cyan-accent" />
          {t("وكيل توليد الفيديو من الصور", "AI Video-from-Images Agent")}
          <span className="text-[9px] font-normal text-muted-foreground">
            {t("فهم ← تحليل ← مشهد بملامح حقيقية ← فيديو بالصوت", "understand → analyze → real-faces scene → video with audio")}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {/* صور الأشخاص */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">
            <Users className="h-3 w-3 inline me-1" />
            {t("صور الأشخاص (اختياري — حتى 4): أشخاصك + أشخاص آخرين أو اذكر شخصية بالاسم في الفكرة", "People images (optional, up to 4): your people + others, or name a public figure in the idea")}
          </Label>
          <div className="flex items-center gap-2 flex-wrap">
            {images.map((img, i) => (
              <div key={img.path} className="relative h-14 w-14 rounded-md border border-border overflow-hidden bg-black/30">
                <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute top-0.5 end-0.5 h-4 w-4 rounded-full bg-black/70 hover:bg-red-500/85 flex items-center justify-center"
                  aria-label={t("إزالة الصورة", "Remove image")}
                >
                  <X className="h-2.5 w-2.5 text-white" />
                </button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="h-14 w-14 rounded-md border border-dashed border-cyan-accent/40 flex flex-col items-center justify-center text-muted-foreground hover:text-cyan-accent hover:bg-black/30 transition"
                aria-label={t("إضافة صورة", "Add image")}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="text-[8px]">{t("إضافة", "Add")}</span>
              </button>
            )}
            <span className="text-[10px] text-muted-foreground">{t("المحرك يحافظ على ملامح الوجوه الحقيقية", "Real facial features are preserved")}</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) upload(files);
              e.currentTarget.value = "";
            }}
            aria-hidden="true"
          />
        </div>

        {/* الفكرة */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            "اكتب فكرة الفيديو — مثال: «فيديو زفافنا وأنا وأحبتي على شاطئ البحر نتحرك ونضحك بملابس البحر عند الغروب» — أو اجعلني أحتضن الفنان فلان سينمائيًا",
            "Describe your video idea — the agent composes the people into the scene with real faces, then animates it…"
          )}
          className="w-full h-20 text-[11px] bg-black/30 border border-cyan-accent/30 rounded p-2 resize-none"
        />

        {/* الخيارات الأساسية */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">{t("الجودة", "Quality")}</span>
            <Select value={quality} onValueChange={(v) => setQuality(v as "speed" | "quality")}>
              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="speed" className="text-[10px]">{t("سرعة", "Speed")}</SelectItem>
                <SelectItem value="quality" className="text-[10px]">{t("عالية", "High")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">{t("المدة", "Duration")}</span>
            <Select value={String(durationSec)} onValueChange={(v) => setDurationSec(Number(v) === 10 ? 10 : 5)}>
              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5" className="text-[10px]">5 {t("ثوانٍ", "s")}</SelectItem>
                <SelectItem value="10" className="text-[10px]">10 {t("ثوانٍ", "s")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">{t("حجم العرض", "Display size")}</span>
            <Select value={videoSize} onValueChange={setVideoSize}>
              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SIZE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-[10px]">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">{t("الكادر", "FPS")}</span>
            <Select value={String(fps)} onValueChange={(v) => setFps(Number(v) === 24 ? 24 : 30)}>
              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30" className="text-[10px]">30 FPS</SelectItem>
                <SelectItem value="24" className="text-[10px]">24 FPS {t("(سينمائي)", "(cinema)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">{t("الصيغة", "Format")}</span>
            <Select value={format} onValueChange={(v) => setFormat(v as "mp4" | "webm" | "gif")}>
              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4" className="text-[10px]">MP4</SelectItem>
                <SelectItem value="webm" className="text-[10px]">WebM</SelectItem>
                <SelectItem value="gif" className="text-[10px]">GIF</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-0.5">
            <span className="text-[9px] text-muted-foreground">{t("طريقة العرض", "Style")}</span>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STYLE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-[10px]">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* الصوت */}
        <div className="rounded-md bg-black/20 border border-border p-2 space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
              <Sparkles className="h-3 w-3 text-cyan-accent" />
              {t("صوت المحرك الأصلي", "Native engine audio")}
              <Switch checked={nativeAudio} onCheckedChange={setNativeAudio} aria-label="native audio" />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
              <Mic className="h-3 w-3 text-cyan-accent" />
              {t("تعليق صوتي", "Voice narration")}
              <Switch checked={narrationOn} onCheckedChange={setNarrationOn} aria-label="narration" />
            </label>
            <label className="flex items-center gap-1.5 text-[10px]">
              <Music className="h-3 w-3 text-cyan-accent" />
              <Select value={music} onValueChange={setMusic}>
                <SelectTrigger className="h-6 w-[120px] text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MUSIC_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[10px]">{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          {narrationOn && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              <Input
                value={narrationScript}
                onChange={(e) => setNarrationScript(e.target.value)}
                placeholder={t("نص التعليق (اختياري — الوكيل يكتبه إن تُرك فارغًا)", "Narration text (optional — agent writes it)")}
                className="h-7 text-[10px] sm:col-span-3"
              />
              <Select value={lang} onValueChange={setLang}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANG_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[10px]">{t("اللغة واللهجة", "Language")}: {o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={speed} onValueChange={setSpeed}>
                <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["0.75", "1", "1.25", "1.5"].map((s) => (
                    <SelectItem key={s} value={s} className="text-[10px]">{t("السرعة", "Speed")} ×{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* زر التوليد */}
        <Button
          size="sm"
          onClick={start}
          disabled={busy || !prompt.trim()}
          className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy ? t("الوكيل يعمل…", "Agent working…") : t("ولّد الفيديو من الصور", "Generate video from images")}
        </Button>

        {/* التقدم */}
        {(busy || (phase && phase !== "done")) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[9px] text-muted-foreground">
              <span>{PHASE_LABELS[phase] ?? phase}</span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
              <div className="h-full bg-cyan-accent/80 rounded-full transition-all duration-500" style={{ width: `${Math.max(progress, 4)}%` }} />
            </div>
          </div>
        )}

        {/* خطأ */}
        {error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 p-2 text-[10px] text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* النتيجة */}
        {result && (
          <div className="space-y-2">
            <div className="overflow-auto rounded-md bg-black/60 border border-border" style={{ maxHeight: 460 }}>
              <div
                style={{
                  transform: `scale(${scale})`,
                  transformOrigin: "center center",
                  transition: "transform 120ms ease-out",
                }}
              >
                <video src={result.url} controls playsInline className="w-full max-h-[450px]" />
              </div>
            </div>

            {/* معلومات */}
            <div className="flex items-center gap-2 flex-wrap text-[9px] text-muted-foreground">
              <span className="inline-flex items-center gap-0.5 text-emerald-400">
                <CheckCircle2 className="h-3 w-3" />
                {result.format.toUpperCase()} · {result.width}×{result.height} · {Math.round(result.duration)}ث · {result.sizeMB}MB · {result.style}
              </span>
              {result.lockNote && <span>🔒 {result.lockNote}</span>}
              {result.narrationScript && <span dir="auto">🎙 «{result.narrationScript.slice(0, 80)}{result.narrationScript.length > 80 ? "…" : ""}»</span>}
              {result.narrationNote && <span className="text-amber-300">{result.narrationNote}</span>}
              {result.degraded && <span className="text-amber-300">{result.degraded}</span>}
              {result.sceneUrl && (
                <a href={result.sceneUrl} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  {t("صورة المشهد الأساس", "Base scene image")}
                </a>
              )}
            </div>

            {/* الأزرار السبعة */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="secondary" className="h-8 text-[10px] flex-1 min-w-[92px]" disabled={busy} onClick={enhance} title="تحسين جودة الفيديو">
                <Sparkles className="h-3 w-3" />
                {t("تحسين الجودة", "Enhance")}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[10px] flex-1 min-w-[70px]" onClick={save} title="حفظ الفيديو">
                <Download className="h-3 w-3" />
                {t("حفظ", "Save")}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-[10px] flex-1 min-w-[70px]" onClick={printPoster} title="طباعة الملصق">
                <Printer className="h-3 w-3" />
                {t("طباعة", "Print")}
              </Button>
              <div className="flex items-center gap-1.5 ms-auto">
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!canUndo} onClick={() => setIdx((i) => Math.max(0, i - 1))} title="الرجوع لنسخة سابقة" aria-label="الرجوع">
                  <Undo2 className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={!canRedo} onClick={() => setIdx((i) => Math.min(history.length - 1, i + 1))} title="التقدم لنسخة أحدث" aria-label="التقدم">
                  <Redo2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 px-1">
              <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" disabled={zoom === 0} onClick={() => setZoom(0)} title="تصغير الزوم إلى 0 (إظهار كامل الفيديو)" aria-label="تصغير">
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <input
                type="range"
                min={0}
                max={100}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-cyan-400"
                aria-label={t("زوم الفيديو", "Video zoom")}
              />
              <Button variant="outline" size="icon" className="h-7 w-7 shrink-0" disabled={zoom >= 100} onClick={() => setZoom(100)} title="تكبير الزوم إلى الحد الأقصى" aria-label="تكبير">
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] tabular-nums text-muted-foreground w-9 text-center">{zoom === 0 ? t("كامل", "Fit") : `${zoom}%`}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
