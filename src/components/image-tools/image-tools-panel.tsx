"use client";
import { useI18n } from "@/lib/i18n";
import { useUndoRedoStore } from "@/stores/undo-redo-store";
import { useImageStore } from "@/stores/image-store";
import { useToast } from "@/hooks/use-toast";
import { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ZoomIn, ZoomOut, Palette, Wand2, Maximize, Loader2, Sparkles, Box, Brush, Pencil, Grid3x3, Layers, Sun, Droplet, Expand, UploadCloud, RotateCw, Trash2, Undo2, Redo2, X, Crop, FlipHorizontal, FlipVertical, Focus, CloudFog, Sliders, Eraser, Stamp, ImageIcon, Scissors, Save, Download, ExternalLink, Users, ArrowRight, Clock, Zap, CheckCircle2 } from "lucide-react";
import { TargetSelector } from "@/components/shared/target-selector";
import { SaveButton } from "@/components/shared/save-button";
import { ProgressIndicator } from "@/components/shared/progress-indicator";
import { CropOverlay, type CropRect } from "./crop-overlay";

interface LocalImage { path: string; url: string; width: number; height: number; name: string; }
const SECTION_ID = "image-tools";

// Image convert formats and options
const IMAGE_FORMATS_LIST = [
  { value: "jpg", label: "JPG" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
  { value: "gif", label: "GIF (animated)" },
  { value: "bmp", label: "BMP" },
  { value: "tiff", label: "TIFF" },
  { value: "tif", label: "TIF" },
  { value: "avif", label: "AVIF" },
  { value: "heic", label: "HEIC" },
  { value: "heif", label: "HEIF" },
  { value: "ico", label: "ICO" },
  { value: "psd", label: "PSD" },
  { value: "tga", label: "TGA" },
  { value: "ppm", label: "PPM" },
  { value: "pgm", label: "PGM" },
  { value: "pbm", label: "PBM" },
];
const IMG_QUALITY_LEVELS = [
  { value: "low", ar: "سريع", en: "Fast" },
  { value: "medium", ar: "متوسط", en: "Medium" },
  { value: "high", ar: "عالي", en: "High" },
  { value: "ultra", ar: "أقصى", en: "Ultra" },
];
const IMG_UPSCALE_FACTORS = [
  { value: "1", label: "1× (بدون)" },
  { value: "1.5", label: "1.5×" },
  { value: "2", label: "2×" },
  { value: "3", label: "3×" },
  { value: "4", label: "4×" },
];

function fmtBytesConv(n?: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtTimeConv(s?: number) {
  if (!s || s < 0) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m < 60) return `${m}m ${sec}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

interface ImgConvProgress {
  phase: "uploading" | "processing" | "done" | "error";
  progress: number;
  bytesReceived?: number;
  bytesTotal?: number;
  elapsedSeconds?: number;
  etaSeconds?: number;
  speedMBs?: number;
}

export function ImageToolsPanel() {
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [image, setImage] = useState<LocalImage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cropMode, setCropMode] = useState(false);
  const [imgDisplayRect, setImgDisplayRect] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  // === Image Convert state ===
  const [imgConvFile, setImgConvFile] = useState<File | null>(null);
  const [imgConvTargetFormat, setImgConvTargetFormat] = useState("webp");
  const [imgConvQuality, setImgConvQuality] = useState("high");
  const [imgConvUpscale, setImgConvUpscale] = useState("1");
  const [imgConvSharpen, setImgConvSharpen] = useState(false);
  const [imgConvDenoise, setImgConvDenoise] = useState(false);
  const [imgConvColorEnhance, setImgConvColorEnhance] = useState(false);
  const [imgConvBoost, setImgConvBoost] = useState(false);
  const [imgConvNormalize, setImgConvNormalize] = useState(false);
  const [imgConvResult, setImgConvResult] = useState<any>(null);
  const [imgConvProgress, setImgConvProgress] = useState<ImgConvProgress | null>(null);
  const imgConvInputRef = useRef<HTMLInputElement>(null);
  const imgConvXhrRef = useRef<XMLHttpRequest | null>(null);

  const handleImageConvert = useCallback(() => {
    if (!imgConvFile) return;
    setBusy("img-convert");
    setImgConvResult(null);
    const startTime = Date.now();
    const params = new URLSearchParams({
      filename: imgConvFile.name,
      size: String(imgConvFile.size),
      targetFormat: imgConvTargetFormat,
      quality: imgConvQuality,
      upscale: imgConvUpscale,
      sharpen: imgConvSharpen ? "1" : "0",
      denoise: imgConvDenoise ? "1" : "0",
      colorEnhance: imgConvColorEnhance ? "1" : "0",
      boost: imgConvBoost ? "1" : "0",
      normalize: imgConvNormalize ? "1" : "0",
    });
    const url = `/api/images/convert?${params.toString()}`;
    const xhr = new XMLHttpRequest();
    imgConvXhrRef.current = xhr;
    xhr.open("POST", url, true);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMBs = elapsedSec > 0 ? (e.loaded / 1024 / 1024) / elapsedSec : 0;
      const etaSec = speedMBs > 0 ? (e.total - e.loaded) / 1024 / 1024 / speedMBs : 0;
      setImgConvProgress({
        phase: "uploading",
        progress: Math.round((e.loaded / e.total) * 50),
        bytesReceived: e.loaded,
        bytesTotal: e.total,
        elapsedSeconds: Math.round(elapsedSec),
        etaSeconds: Math.round(etaSec),
        speedMBs: parseFloat(speedMBs.toFixed(2)),
      });
    });

    xhr.upload.addEventListener("error", () => {
      setImgConvProgress({ phase: "error", progress: 0 });
      setBusy(null);
    });

    xhr.addEventListener("load", () => {
      let d: any;
      try { d = xhr.response; } catch { d = null; }
      if (!d || !d.taskId) {
        setImgConvProgress({ phase: "error", progress: 0 });
        setBusy(null);
        return;
      }
      const taskId = d.taskId;
      const pollStart = Date.now();
      const poll = async () => {
        for (let i = 0; i < 600; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const elapsedSec = (Date.now() - pollStart) / 1000;
          try {
            const pr = await fetch(`/api/task/status?id=${taskId}`);
            const pd = await pr.json();
            if (pd.status === "done" && pd.result) {
              setImgConvResult(pd.result);
              setImgConvProgress({ phase: "done", progress: 100, elapsedSeconds: Math.round((Date.now() - startTime) / 1000) });
              setBusy(null);
              return;
            }
            if (pd.status === "error") {
              setImgConvProgress({ phase: "error", progress: pd.progress || 0 });
              setBusy(null);
              return;
            }
            const currentProgress = pd.progress || 50;
            const convElapsed = currentProgress > 50 ? (elapsedSec / (currentProgress - 50)) * (100 - currentProgress) : 0;
            setImgConvProgress({
              phase: pd.phase === "uploading" ? "uploading" : "processing",
              progress: currentProgress,
              bytesReceived: pd.bytesReceived,
              bytesTotal: pd.bytesTotal,
              elapsedSeconds: Math.round(elapsedSec),
              etaSeconds: Math.round(Math.max(0, convElapsed)),
              speedMBs: pd.speedMBs,
            });
          } catch {}
        }
        setImgConvProgress({ phase: "error", progress: 0 });
        setBusy(null);
      };
      void poll();
    });

    xhr.addEventListener("error", () => {
      setImgConvProgress({ phase: "error", progress: 0 });
      setBusy(null);
    });

    xhr.send(imgConvFile);
  }, [imgConvFile, imgConvTargetFormat, imgConvQuality, imgConvUpscale, imgConvSharpen, imgConvDenoise, imgConvColorEnhance, imgConvBoost, imgConvNormalize]);

  const handleCancelImgConvert = useCallback(() => {
    if (imgConvXhrRef.current) {
      imgConvXhrRef.current.abort();
      imgConvXhrRef.current = null;
    }
    setBusy(null);
    setImgConvProgress(null);
  }, []);

  // Helper format functions for image convert (uses fmtBytesConv and fmtTimeConv from above)
  const fmtBytes = fmtBytesConv;
  const fmtTime = fmtTimeConv;
  const isAr = locale === "ar";
  // Style transform result preview — kept separate from the main image so
  // both the original (top area) and the latest style-transform result
  // (next to the 8 style buttons) can be visible at the same time.
  const [styleResult, setStyleResult] = useState<{ url: string; path: string; width: number; height: number; style: string; styleLabel: string; at: number } | null>(null);
  // Age transform result preview — a separate preview box, just like
  // styleResult but for the age-transformation buttons. Keeps both
  // style and age results visible at the same time. Includes the detected
  // gender so the footer can show "Male: child (4-10 yrs)" etc.
  const [ageResult, setAgeResult] = useState<{ url: string; path: string; width: number; height: number; age: string; ageLabel: string; ageRange: string; gender: "male" | "female" | null; at: number } | null>(null);
  // Zoom level for the style-result preview box (matches the main image's zoom UX)
  const [styleZoom, setStyleZoom] = useState(1);
  // Zoom level for the age-result preview box (independent from styleZoom)
  const [ageZoom, setAgeZoom] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement>(null);

  const pushHistory = useUndoRedoStore((s) => s.pushHistory);
  const undo = useUndoRedoStore((s) => s.undo);
  const redo = useUndoRedoStore((s) => s.redo);
  const canUndo = useUndoRedoStore((s) => s.canUndo);
  const canRedo = useUndoRedoStore((s) => s.canRedo);
  const undoable = canUndo(SECTION_ID);
  const redoable = canRedo(SECTION_ID);
  // Persist the current image so the Garment Editor can pick it up
  // when the user selects the "imageTools" sub-tab inside it.
  const setImageToolsImage = useImageStore((s) => s.setImageToolsImage);
  const storedImageToolsImage = useImageStore((s) => s.imageToolsImage);

  // === Restore image from the persisted image store on mount ===
  // When the user switches tabs and comes back, the local useState
  // `image` is lost. Restore it from the image store (which IS
  // persisted in localStorage).
  useEffect(() => {
    if (!image && storedImageToolsImage?.url) {
      setImage({
        path: storedImageToolsImage.path,
        url: storedImageToolsImage.url,
        width: storedImageToolsImage.width,
        height: storedImageToolsImage.height,
        name: storedImageToolsImage.name,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Helper: convert a LocalImage into the richer UploadedImage shape
   * used by the global image-store.
   */
  const toStored = (img: LocalImage) => ({
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: img.name,
    path: img.path,
    url: img.url,
    mime: "image/png",
    size: 0,
    width: img.width,
    height: img.height,
    format: "png",
    uploadedAt: Date.now(),
  });

  const [enhanceScale, setEnhanceScale] = useState<2 | 4>(2);
  const [enhanceQuality, setEnhanceQuality] = useState<"hd" | "fullHd" | "twoK" | "fourK" | "ultraHd">("hd");
  const [expandDir, setExpandDir] = useState<"all" | "left" | "right" | "top" | "bottom">("all");
  const [expandPct, setExpandPct] = useState(20);
  const [rtSmoothness, setRtSmoothness] = useState(30);
  const [bgMode, setBgMode] = useState<"preset" | "description" | "color">("preset");
  const [bgDescription, setBgDescription] = useState("");
  const [bgColor, setBgColor] = useState("#1a1a2e");
  const [bgCat, setBgCat] = useState("nature");
  const [bgName, setBgName] = useState("forest");
  const [cropLeft, setCropLeft] = useState(0);
  const [cropTop, setCropTop] = useState(0);
  const [cropW, setCropW] = useState(300);
  const [cropH, setCropH] = useState(400);
  const [rotateAngle, setRotateAngle] = useState(90);
  const [flipDir, setFlipDir] = useState<"horizontal" | "vertical">("horizontal");
  const [sharpenAmt, setSharpenAmt] = useState(2);
  const [blurRadius, setBlurRadius] = useState(5);
  const [filterType, setFilterType] = useState("grayscale");
  const [rmBgColor, setRmBgColor] = useState("#ffffff");
  const [rmObjDesc, setRmObjDesc] = useState("");
  const [wmText, setWmText] = useState("AI Studio");
  const [wmOpacity, setWmOpacity] = useState(40);
  const [aiGenPrompt, setAiGenPrompt] = useState("");
  const [aiGenAspect, setAiGenAspect] = useState<"1:1" | "16:9" | "9:16" | "4:3" | "3:4">("1:1");
  const [aiGenStage, setAiGenStage] = useState(0); // 0=idle, 1..5 pipeline stages
  const [aiGenInfo, setAiGenInfo] = useState<{
    understanding?: string; analysis?: string; reasoning?: string; enhancedPrompt?: string;
    thinker?: string; imageModel?: string; attempts?: number; critiqueScore?: number | null; critiqueNote?: string;
  } | null>(null);

  // === Color Editor state ===
  const [caBrightness, setCaBrightness] = useState(0);
  const [caContrast, setCaContrast] = useState(0);
  const [caSaturation, setCaSaturation] = useState(0);
  const [caHue, setCaHue] = useState(0);
  const [caTemperature, setCaTemperature] = useState(0);
  const [caTint, setCaTint] = useState(0);
  const [caVibrance, setCaVibrance] = useState(0);
  const [caExposure, setCaExposure] = useState(0);
  const [caShowAdvanced, setCaShowAdvanced] = useState(false);
  const resetColorAdjust = () => {
    setCaBrightness(0); setCaContrast(0); setCaSaturation(0);
    setCaHue(0); setCaTemperature(0); setCaTint(0);
    setCaVibrance(0); setCaExposure(0);
  };

  // === Enhance Full Image — multi-level escalation (HD → FHD → 2K → 4K → 8K ULTRA) ===
  // Each level enhances ALL details of the image progressively using the AI pipeline.
  const [enhanceFullLevel, setEnhanceFullLevel] = useState(0);
  const ENHANCE_FULL_LEVELS = [
    { quality: "hd" as const, label: "HD", labelAr: "HD 1280p", desc: "تحسين أساسي — يضيف تفاصيل ويحدّد الحواف" },
    { quality: "fullHd" as const, label: "FHD", labelAr: "Full HD 1920p", desc: "تحسين متقدم — تفاصيل أعلى + نسيج أوضح" },
    { quality: "twoK" as const, label: "2K", labelAr: "2K 2560p", desc: "جودة عالية — تفاصيل دقيقة للبشرة والقماش" },
    { quality: "fourK" as const, label: "4K", labelAr: "4K 3840p", desc: "جودة فائقة — كل تفصيل ظاهر بدقة" },
    { quality: "ultraHd" as const, label: "ULTRA", labelAr: "Ultra HD 7680p 8K", desc: "أعلى جودة — تفاصيل احترافية كاملة" },
  ];

  const handleEnhanceFull = async (levelIdx?: number) => {
    if (!image) return;
    const idx = levelIdx ?? enhanceFullLevel;
    const level = ENHANCE_FULL_LEVELS[idx];
    if (!level) return;
    setBusy("enhance-full");
    setEnhanceFullLevel(idx);
    try {
      const r = await fetch("/api/images/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: image.path, quality: level.quality })
      });
      const d = await r.json();
      if (r.ok) {
        updateImage(d);
        toast({
          title: locale === "ar" ? `تم التحسين — ${level.labelAr}` : `Enhanced — ${level.label}`,
          description: `${d.width}×${d.height} · ${d.method}`
        });
      } else {
        toast({ title: "Error", description: d.error || d.message, variant: "destructive" });
      }
    } finally { setBusy(null); }
  };

  // === Color Editor handler (calls /api/images/color-adjust) ===
  const handleColorAdjust = async () => {
    if (!image) return;
    setBusy("color-adjust");
    try {
      const r = await fetch("/api/images/color-adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: image.path,
          brightness: caBrightness,
          contrast: caContrast,
          saturation: caSaturation,
          hue: caHue,
          temperature: caTemperature,
          tint: caTint,
          vibrance: caVibrance,
          exposure: caExposure,
        })
      });
      const d = await r.json();
      if (r.ok) {
        updateImage(d);
        toast({
          title: locale === "ar" ? "تم تطبيق تعديلات الألوان" : "Color adjustments applied",
        });
        resetColorAdjust();
      } else {
        toast({ title: "Error", description: d.error || d.message, variant: "destructive" });
      }
    } finally { setBusy(null); }
  };

  useEffect(() => {
    const el = imageContainerRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { if (!image) return; e.preventDefault(); setZoom((z) => Math.max(0.05, Math.min(50, z * (e.deltaY > 0 ? 0.9 : 1.1)))); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [image]);

  useEffect(() => {
    // Listen to the global undo-redo event dispatched by StudioHeader's
    // Undo/Redo buttons + keyboard shortcuts. This avoids double-handling
    // (the studio-header owns the global keyboard shortcut now).
    const onUndoRedo = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.section !== SECTION_ID) return;
      if (detail?.entry?.state) {
        setImage(detail.entry.state as LocalImage);
      }
    };
    window.addEventListener("undo-redo", onUndoRedo);
    return () => window.removeEventListener("undo-redo", onUndoRedo);
  }, []);

  const onFileSelect = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/images/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        const img: LocalImage = { path: data.path, url: data.url, width: data.width, height: data.height, name: data.name };
        setImage(img);
        setImageToolsImage(toStored(img));
        setZoom(1); // Reset zoom when new image is loaded
        pushHistory(SECTION_ID, `Upload: ${img.name}`, img);
      } else { toast({ title: "Upload failed", description: data.message, variant: "destructive" }); }
    } catch (e) { toast({ title: "Error", description: e instanceof Error ? e.message : "", variant: "destructive" }); }
    finally { setUploading(false); }
  }, [pushHistory, toast, setImageToolsImage]);

  const updateImage = (data: { url: string; path: string; width: number; height: number }) => {
    const next: LocalImage = { path: data.path, url: data.url, width: data.width, height: data.height, name: image?.name ?? "result" };
    setImage(next);
    setImageToolsImage(toStored(next));
    setZoom(1); // Reset zoom when image is updated (e.g., after Enhance)
    pushHistory(SECTION_ID, `Tool: ${busy ?? "result"}`, next);
  };

  const handleEnhance = async () => { if (!image) return; setBusy("enhance"); try { const r = await fetch("/api/images/enhance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, quality: enhanceQuality }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم التحسين" : "Enhanced", description: `${d.width}×${d.height} · ${d.qualityLabel} (${d.method})` }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleColorize = async () => { if (!image) return; setBusy("colorize"); try { const r = await fetch("/api/images/colorize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم التلوين" : "Colorized" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };

  const handleRestore = async () => { if (!image) return; setBusy("restore"); try { const r = await fetch("/api/images/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم الترميم" : "Restored" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleExpand = async () => { if (!image) return; setBusy("expand"); try { const r = await fetch("/api/images/expand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, direction: expandDir, percentage: expandPct }) }); const d = await r.json().catch(() => null); if (r.ok && d) { updateImage(d); const isAi = d.method === "ai-outpaint-seamless"; toast({ title: locale === "ar" ? "تم التوسيع" : "Expanded", description: `${d.width}×${d.height} · ${isAi ? (locale === "ar" ? "توسيع ذكي AI" : "AI outpaint") : (locale === "ar" ? "تمديد انعكاسي محلي" : "local mirror-extend")}` }); } else toast({ title: "Error", description: (d && (d.error || d.message)) || (locale === "ar" ? "فشل التوسيع — حاول مجدداً" : "Expand failed — try again"), variant: "destructive" }); } catch (e) { toast({ title: "Error", description: locale === "ar" ? "فشل الاتصال بالخادم أثناء التوسيع" : "Connection failed during expand", variant: "destructive" }); } finally { setBusy(null); } };
  const handleFaceRetouch = async () => { if (!image) return; setBusy("face-retouch"); try { const r = await fetch("/api/images/face-retouch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, smoothness: rtSmoothness }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم تنعيم البشرة" : "Face Retouched", description: `smoothness ${rtSmoothness}% (${d.method})` }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };

  const handleBackgroundChange = async () => {
    if (!image) return; setBusy("bg-change");
    try {
      const payload: Record<string, unknown> = { sourcePath: image.path, mode: bgMode };
      if (bgMode === "description") payload.backgroundDescription = bgDescription;
      else if (bgMode === "color") payload.backgroundColor = bgColor;
      else { payload.presetCategory = bgCat; payload.presetName = bgName; }
      const r = await fetch("/api/images/change-background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم تغيير الخلفية" : "Background Changed" }); }
      else toast({ title: "Error", description: d.error || d.message, variant: "destructive" });
    } finally { setBusy(null); }
  };


  // === NEW TOOL HANDLERS ===
  const handleCrop = async (rect?: CropRect) => { if (!image) return; setBusy("crop"); try {
    const body: Record<string, unknown> = { sourcePath: image.path };
    if (rect) {
      // From the interactive overlay — already in image-space coordinates
      body.left = Math.round(rect.x);
      body.top = Math.round(rect.y);
      body.width = Math.round(rect.width);
      body.height = Math.round(rect.height);
    } else {
      // Fallback to manual numeric inputs
      body.left = cropLeft;
      body.top = cropTop;
      body.width = cropW;
      body.height = cropH;
    }
    const r = await fetch("/api/images/crop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (r.ok) {
      updateImage(d);
      pushHistory(SECTION_ID, "Tool: crop", d);
      toast({ title: locale === "ar" ? "تم الاقتصاص" : "Cropped", description: `${d.width}x${d.height}` });
    } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" });
  } finally { setBusy(null); setCropMode(false); } };
  const handleRotate = async () => { if (!image) return; setBusy("rotate"); try { const r = await fetch("/api/images/rotate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, angle: rotateAngle }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم التدوير" : "Rotated", description: `${rotateAngle}deg` }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleFlip = async () => { if (!image) return; setBusy("flip"); try { const r = await fetch("/api/images/flip", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, direction: flipDir }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم القلب" : "Flipped" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleSharpen = async () => { if (!image) return; setBusy("sharpen"); try { const r = await fetch("/api/images/sharpen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, amount: sharpenAmt }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم الشحذ" : "Sharpened" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleBlur = async () => { if (!image) return; setBusy("blur"); try { const r = await fetch("/api/images/blur", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, radius: blurRadius }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم التضبيب" : "Blurred" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleFilter = async () => { if (!image) return; setBusy("filter"); try { const r = await fetch("/api/images/filters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, filter: filterType }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم تطبيق الفلتر" : "Filtered" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleRemoveBg = async () => { if (!image) return; setBusy("rm-bg"); try { const r = await fetch("/api/images/remove-background", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, backgroundColor: rmBgColor }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم إزالة الخلفية" : "BG Removed" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleRemoveObj = async () => { if (!image) return; setBusy("rm-obj"); try { const r = await fetch("/api/images/remove-object", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, objectDescription: rmObjDesc || "an unwanted object" }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تم إزالة الكائن" : "Object Removed" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleWatermark = async () => { if (!image) return; setBusy("watermark"); try { const r = await fetch("/api/images/watermark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourcePath: image.path, text: wmText, opacity: wmOpacity / 100, position: "bottom-right" }) }); const d = await r.json(); if (r.ok) { updateImage(d); toast({ title: locale === "ar" ? "تمت العلامة المائية" : "Watermarked" }); } else toast({ title: "Error", description: d.error || d.message, variant: "destructive" }); } finally { setBusy(null); } };
  const handleAiGenerate = async () => {
    if (!aiGenPrompt.trim() || busy === "ai-gen") return;
    setBusy("ai-gen");
    setAiGenInfo(null);
    setAiGenStage(1);
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    try {
      // 1) Start the async job — returns a jobId immediately (a long
      //    synchronous POST gets cut by the preview proxy into an HTML
      //    error page → "Unexpected token '<'… is not valid JSON").
      const r = await fetch("/api/images/ai-generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: aiGenPrompt.trim(), aspectRatio: aiGenAspect }) });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok || !d?.jobId) {
        setAiGenStage(0);
        toast({ title: "Error", description: d?.error || d?.message || (locale === "ar" ? "تعذّر بدء التوليد — حاول مجدداً" : "Failed to start generation"), variant: "destructive" });
        return;
      }

      // 2) Poll the job — server stages: thinking → generating → reviewing → done
      const jobId = String(d.jobId);
      const STAGE_MAP: Record<string, number> = { thinking: 1, generating: 4, reviewing: 5, done: 5 };
      let lostJob = false;
      await new Promise<void>((resolve) => {
        const startedAt = Date.now();
        let inFlight = false;
        pollTimer = setInterval(async () => {
          if (inFlight) return;
          inFlight = true;
          try {
            const pr = await fetch(`/api/images/ai-generate?jobId=${encodeURIComponent(jobId)}`);
            const pj = await pr.json().catch(() => null);
            if (pr.status === 404) { lostJob = true; resolve(); return; }
            if (!pr.ok || !pj?.ok) return; // transient — keep polling
            if (pj.stage === "thinking") {
              // gentle creep through the 3 thinking sub-stages while the LLM works
              setAiGenStage((s) => Math.min(3, s + 1));
            } else if (pj.stage && STAGE_MAP[pj.stage] !== undefined) {
              setAiGenStage(STAGE_MAP[pj.stage]);
            }
            if (pj.status === "done" && pj.result?.ok) {
              const res = pj.result;
              const newImg: LocalImage = { path: res.path, url: res.url, width: res.width, height: res.height, name: "ai-generated" };
              setImage(newImg);
              setImageToolsImage(toStored(newImg));
              setZoom(1);
              pushHistory(SECTION_ID, "AI Generate", newImg);
              setAiGenInfo({
                understanding: res.analysis?.understanding, analysis: res.analysis?.analysis, reasoning: res.analysis?.reasoning,
                enhancedPrompt: res.analysis?.enhancedPrompt, thinker: res.provider, imageModel: res.imageModel,
                attempts: res.attempts, critiqueScore: res.critique?.score ?? null, critiqueNote: res.critique?.note ?? "",
              });
              toast({ title: locale === "ar" ? "تم التوليد الذكي" : "Smart generation done", description: locale === "ar" ? `التقييم ${res.critique?.score ?? "—"}/100` : `Review score ${res.critique?.score ?? "—"}/100` });
              resolve();
            } else if (pj.status === "error") {
              toast({ title: "Error", description: pj.errorMessage || pj.result?.errorMessage || (locale === "ar" ? "فشل التوليد — جرّب وصفاً آخر" : "Generation failed"), variant: "destructive" });
              setAiGenStage(0);
              resolve();
            } else if (Date.now() - startedAt > 4 * 60 * 1000) {
              toast({ title: "Error", description: locale === "ar" ? "انتهت مهلة التوليد — حاول مجدداً" : "Generation timed out", variant: "destructive" });
              setAiGenStage(0);
              resolve();
            }
          } catch { /* transient — keep polling */ } finally { inFlight = false; }
        }, 2500);
      });
      if (lostJob) {
        setAiGenStage(0);
        toast({ title: "Error", description: locale === "ar" ? "انتهت صلاحية المهمة (ربما أُعيد تشغيل الخادم) — أعد المحاولة" : "Job expired (server restarted?) — try again", variant: "destructive" });
      }
    } catch (e) {
      setAiGenStage(0);
      toast({ title: "Error", description: e instanceof Error ? e.message : "network error", variant: "destructive" });
    } finally {
      if (pollTimer) clearInterval(pollTimer);
      setBusy(null);
      setTimeout(() => setAiGenStage((s) => (s === 5 ? 0 : s)), 2500);
    }
  };

  const handleUndo = useCallback(() => { const e = undo(SECTION_ID); if (e?.state) setImage(e.state as LocalImage); }, [undo]);
  const handleRedo = useCallback(() => { const e = redo(SECTION_ID); if (e?.state) setImage(e.state as LocalImage); }, [redo]);

  return (
    <div className="flex flex-col gap-3">
      <Card className="studio-panel border-panel-border">
        <CardContent className="py-2 flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={handleUndo} disabled={!undoable} className="h-8 px-3"><Undo2 className="h-3.5 w-3.5" /><span className="ml-1 text-xs">{locale === "ar" ? "تراجع" : "Undo"}</span></Button>
          <Button size="sm" variant="outline" onClick={handleRedo} disabled={!redoable} className="h-8 px-3"><Redo2 className="h-3.5 w-3.5" /><span className="ml-1 text-xs">{locale === "ar" ? "إعادة" : "Redo"}</span></Button>
          {image && (<><Button size="sm" variant="outline" onClick={() => setZoom(1)} className="h-8 px-3" title={locale === "ar" ? "إعادة الضبط" : "Reset to fit"}><RotateCw className="h-3.5 w-3.5" /></Button><Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.05, z * 0.9))} className="h-8 px-3" title={locale === "ar" ? "تصغير" : "Zoom out"}><ZoomOut className="h-3.5 w-3.5" /></Button><Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(50, z * 1.1))} className="h-8 px-3" title={locale === "ar" ? "تكبير" : "Zoom in"}><ZoomIn className="h-3.5 w-3.5" /></Button><span className="text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span></>)}
          <div className="flex-1" />
          {image && <TargetSelector section={SECTION_ID} options={["source", "result"]} />}
          {image && <SaveButton sourcePath={image.path} variant="default" filename={`image-tools-${Date.now()}`} />}
          {image && (<Button size="sm" variant="outline" onClick={() => setImage(null)} className="h-8 px-3 text-red-400"><Trash2 className="h-3.5 w-3.5" /><span className="ml-1 text-xs">{locale === "ar" ? "مسح" : "Clear"}</span></Button>)}
        </CardContent>
      </Card>
      {/* Progress indicator — shows during any image operation */}
      <ProgressIndicator
        busy={!!busy || uploading}
        label={uploading ? "جارٍ رفع الصورة..." : busy ? `جارٍ ${busy === "enhance" ? "التحسين" : busy === "colorize" ? "التلوين" : busy === "restore" ? "الترميم" : busy === "filter" ? "الفلتر" : busy === "face-retouch" ? "تنعيم البشرة" : busy === "bg-change" ? "تغيير الخلفية" : busy === "expand" ? "التوسيع" : busy === "sharpen" ? "الشحذ" : busy === "blur" ? "التضبيب" : busy === "flip" ? "القلب" : busy === "rotate" ? "التدوير" : busy === "crop" ? "القص" : "المعالجة"}...` : "المعالجة"}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card className="studio-panel border-panel-border lg:col-span-2 min-h-[400px]">
          <CardContent className="p-0 relative h-[500px] overflow-hidden">
            {!image ? (
              <div onClick={() => inputRef.current?.click()} className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer hover:bg-cyan-accent/[0.03]">
                <div className="h-14 w-14 rounded-full bg-cyan-accent/10 flex items-center justify-center mb-3">{uploading ? <Loader2 className="h-6 w-6 text-cyan-accent animate-spin" /> : <UploadCloud className="h-6 w-6 text-cyan-accent" />}</div>
                <p className="text-sm font-medium">{locale === "ar" ? "ارفع صورة للبدء" : "Upload an image to start"}</p>
                <p className="text-xs text-muted-foreground mt-1">{locale === "ar" ? "اسحب وأفلت أو انقر" : "Drag & drop or click"}</p>
                <input ref={inputRef} type="file" accept=".jpg,.jpeg,.png,.webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFileSelect(f); e.target.value = ""; }} />
              </div>
            ) : (
              <div ref={imageContainerRef} className="absolute inset-0 overflow-auto bg-black/30" style={{ cursor: zoom > 1 ? "grab" : "default" }}>
                {/* Image sizing strategy (fixed):
                    - The wrapper's dimensions = base display size × zoom factor
                    - The img uses width:100%, height:100% of the wrapper
                    - When zoom=1: wrapper = base size (fits container)
                    - When zoom>1: wrapper grows → img grows → container scrolls
                    - When cropMode: lock zoom to 1 so overlay aligns correctly */}
                <div
                  className="flex items-center justify-center min-h-full min-w-full"
                  style={{
                    width: `${zoom * 100}%`,
                    height: `${zoom * 100}%`,
                  }}
                >
                  {/* Wrapper sized to display dims × zoom — this is what makes
                      the IMAGE actually zoom (not just the container). */}
                  <div
                    style={{
                      position: "relative",
                      width: imgDisplayRect.width > 0 ? `${imgDisplayRect.width * zoom}px` : "auto",
                      height: imgDisplayRect.height > 0 ? `${imgDisplayRect.height * zoom}px` : "auto",
                      lineHeight: 0,  // remove inline-block gap below <img>
                    }}
                  >
                    <img
                      ref={imgElRef}
                      src={image.url}
                      alt={image.name}
                      className="select-none pointer-events-none"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        transition: "all 0.15s ease-out",
                        display: "block",
                      }}
                      draggable={false}
                      onLoad={(e) => {
                        // Measure the image's NATURAL display size at zoom=1
                        // (we use this as the base for zoom multiplication)
                        if (zoom === 1) {
                          const r = (e.target as HTMLImageElement).getBoundingClientRect();
                          setImgDisplayRect({ width: r.width, height: r.height });
                        }
                      }}
                    />
                    {/* Interactive Crop Overlay (when crop mode is active).
                        Rendered INSIDE the image-sized wrapper so its
                        absolute positioning aligns to the image exactly.
                        Zoom is forced to 1 when cropMode is active. */}
                    {cropMode && imgDisplayRect.width > 0 && (
                      <CropOverlay
                        imageWidth={image.width}
                        imageHeight={image.height}
                        displayWidth={imgDisplayRect.width}
                        displayHeight={imgDisplayRect.height}
                        locale={locale}
                        onConfirm={(rect) => void handleCrop(rect)}
                        onCancel={() => setCropMode(false)}
                      />
                    )}
                  </div>
                </div>
                {/* Close button (X) - top-right corner of the image area */}
                <button
                  onClick={() => setImage(null)}
                  className="absolute top-2 right-2 h-9 w-9 rounded-full bg-black/70 backdrop-blur-sm hover:bg-red-500/80 text-white hover:text-white flex items-center justify-center transition-all z-10 ring-1 ring-white/20 hover:ring-red-400"
                  title={locale === "ar" ? "إغلاق الصورة" : "Close image"}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
                {/* Image info badge - top-left */}
                <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-mono text-white/80 z-10">
                  <span>{image.width}×{image.height}</span>
                  <span className="text-white/40">·</span>
                  <span className="truncate max-w-[150px]">{image.name}</span>
                </div>
                {/* Zoom indicator - bottom-right */}
                {zoom !== 1 && (
                  <div className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-mono text-cyan-accent z-10">
                    {Math.round(zoom * 100)}%
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <div className="space-y-3">
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "تحسين الجودة" : "Enhance"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {([
                { k: "hd", l: "HD" },
                { k: "fullHd", l: "FHD" },
                { k: "twoK", l: "2K" },
                { k: "fourK", l: "4K" },
                { k: "ultraHd", l: "ULTRA" }
              ] as const).map((q) => (
                <button
                  key={q.k}
                  onClick={() => setEnhanceQuality(q.k)}
                  className={cn(
                    "px-2 py-1 rounded text-[10px] font-medium transition-all",
                    enhanceQuality === q.k
                      ? "bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent"
                      : "bg-muted/30 hover:bg-muted/50"
                  )}
                  title={
                    q.k === "hd" ? "HD - 1280p"
                    : q.k === "fullHd" ? "Full HD - 1920p"
                    : q.k === "twoK" ? "2K - 2560p"
                    : q.k === "fourK" ? "4K - 3840p"
                    : "Ultra HD - 7680p (8K)"
                  }
                >
                  {q.l}
                </button>
              ))}
            </div>
            <div className="text-[9px] text-muted-foreground px-1">
              {enhanceQuality === "hd" && "1280p"}
              {enhanceQuality === "fullHd" && "1920p"}
              {enhanceQuality === "twoK" && "2560p"}
              {enhanceQuality === "fourK" && "3840p"}
              {enhanceQuality === "ultraHd" && "7680p (8K)"}
            </div>
            <Button size="sm" onClick={handleEnhance} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "enhance" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{locale === "ar" ? "تحسين الجودة" : "Enhance"}</Button>
          </CardContent></Card>
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Palette className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "تلوين" : "Colorize"}</CardTitle></CardHeader><CardContent><Button size="sm" onClick={handleColorize} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "colorize" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}{locale === "ar" ? "أضف الألوان" : "Add Color"}</Button></CardContent></Card>
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Wand2 className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "ترميم" : "Restore"}</CardTitle></CardHeader><CardContent><Button size="sm" onClick={handleRestore} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "restore" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}{locale === "ar" ? "رمم" : "Restore"}</Button></CardContent></Card>
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Maximize className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "توسيع" : "Expand"}</CardTitle></CardHeader><CardContent className="space-y-2"><div className="flex flex-wrap gap-1">{[{ k: "all", l: locale === "ar" ? "الكل" : "All" }, { k: "left", l: locale === "ar" ? "يسار" : "L" }, { k: "right", l: locale === "ar" ? "يمين" : "R" }, { k: "top", l: locale === "ar" ? "أعلى" : "T" }, { k: "bottom", l: locale === "ar" ? "أسفل" : "B" }].map((d) => (<button key={d.k} onClick={() => setExpandDir(d.k as never)} className={cn("px-2 py-1 rounded text-[10px]", expandDir === d.k ? "bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}>{d.l}</button>))}</div><div className="flex items-center gap-2"><Expand className="h-3 w-3" /><Slider value={[expandPct]} min={5} max={50} step={5} onValueChange={(v) => setExpandPct(v[0])} className="flex-1" /><span className="text-[10px] w-8">{expandPct}%</span></div><Button size="sm" onClick={handleExpand} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "expand" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Maximize className="h-3.5 w-3.5" />}{locale === "ar" ? "توسيع" : "Expand"}</Button></CardContent></Card>
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Droplet className="h-4 w-4 text-cyan-accent" />{locale === "ar" ? "تنعيم البشرة" : "Face Retouch"}</CardTitle></CardHeader><CardContent className="space-y-2"><div className="flex items-center gap-2"><Sun className="h-3 w-3" /><Slider value={[rtSmoothness]} min={0} max={100} step={5} onValueChange={(v) => setRtSmoothness(v[0])} className="flex-1" /><span className="text-[10px] w-8">{rtSmoothness}%</span></div><Button size="sm" onClick={handleFaceRetouch} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "face-retouch" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Droplet className="h-3.5 w-3.5" />}{locale === "ar" ? "نعّم البشرة" : "Retouch"}</Button></CardContent></Card>

          {/* === Enhance Full Image — multi-level escalation (HD → FHD → 2K → 4K → 8K ULTRA) === */}
          <Card className="studio-panel border-panel-border ring-1 ring-cyan-accent/30">
            <CardHeader className="py-2">
              <CardTitle className="text-xs flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-accent" />
                {locale === "ar" ? "تحسين الصورة كاملة" : "Enhance Full Image"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-[9px] text-muted-foreground px-1">
                {locale === "ar"
                  ? "تحسين متصاعد لكل تفاصيل الصورة: البشرة، النسيج، الشعر، الحواف، الألوان"
                  : "Progressive enhancement of ALL image details: skin, fabric, hair, edges, colors"}
              </div>
              {/* Level selector — 5 escalating quality levels */}
              <div className="flex flex-wrap gap-1">
                {ENHANCE_FULL_LEVELS.map((lvl, i) => (
                  <button
                    key={lvl.quality}
                    onClick={() => setEnhanceFullLevel(i)}
                    disabled={busy !== null}
                    className={cn(
                      "px-2 py-1.5 rounded text-[10px] font-bold transition-all",
                      enhanceFullLevel === i
                        ? "bg-gradient-to-r from-cyan-accent/30 to-violet-500/30 ring-1 ring-cyan-accent/50 text-cyan-accent"
                        : "bg-muted/30 hover:bg-cyan-accent/15"
                    )}
                    title={locale === "ar" ? lvl.labelAr : lvl.label}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
              {/* Description of selected level */}
              <div className="text-[9px] text-cyan-accent/70 px-1">
                {locale === "ar" ? ENHANCE_FULL_LEVELS[enhanceFullLevel].labelAr : ENHANCE_FULL_LEVELS[enhanceFullLevel].label} — {ENHANCE_FULL_LEVELS[enhanceFullLevel].desc}
              </div>
              {/* Escalate button — applies the selected level */}
              <Button
                size="sm"
                onClick={() => handleEnhanceFull(enhanceFullLevel)}
                disabled={!image || busy !== null}
                className="w-full h-9 text-[11px] bg-gradient-to-r from-cyan-accent to-violet-500 text-black hover:from-cyan-accent/90 hover:to-violet-500/90 font-semibold"
              >
                {busy === "enhance-full" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {locale === "ar" ? `حسّن — ${ENHANCE_FULL_LEVELS[enhanceFullLevel].label}` : `Enhance — ${ENHANCE_FULL_LEVELS[enhanceFullLevel].label}`}
              </Button>
              {/* Quick escalate — click each level directly */}
              <div className="text-[8px] text-muted-foreground px-1 text-center">
                {locale === "ar" ? "اضغط أي مستوى للتحسين المباشر" : "Click any level to enhance directly"}
              </div>
              <div className="grid grid-cols-5 gap-1">
                {ENHANCE_FULL_LEVELS.map((lvl, i) => (
                  <button
                    key={lvl.quality}
                    onClick={() => handleEnhanceFull(i)}
                    disabled={!image || busy !== null}
                    className={cn(
                      "px-1 py-1.5 rounded text-[9px] font-medium transition-all",
                      "bg-gradient-to-b from-muted/30 to-muted/10 hover:from-cyan-accent/20 hover:to-violet-500/20",
                      "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                    title={locale === "ar" ? lvl.labelAr : lvl.label}
                  >
                    {busy === "enhance-full" && enhanceFullLevel === i ? "..." : lvl.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* === Color Editor (sliders) === */}
          <Card className="studio-panel border-panel-border ring-1 ring-violet-500/30">
            <CardHeader className="py-2">
              <CardTitle className="text-xs flex items-center gap-2">
                <Sliders className="h-4 w-4 text-cyan-accent" />
                {locale === "ar" ? "محرر الألوان" : "Color Editor"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2">
                <Sun className="h-3 w-3 text-amber-400" />
                <span className="text-[9px] w-12">{locale === "ar" ? "السطوع" : "Bright"}</span>
                <Slider value={[caBrightness]} min={-100} max={100} step={1} onValueChange={(v) => setCaBrightness(v[0])} className="flex-1" />
                <span className="text-[9px] w-8 text-right">{caBrightness > 0 ? `+${caBrightness}` : caBrightness}</span>
              </div>
              <div className="flex items-center gap-2">
                <Sliders className="h-3 w-3 text-blue-400" />
                <span className="text-[9px] w-12">{locale === "ar" ? "التباين" : "Contrast"}</span>
                <Slider value={[caContrast]} min={-100} max={100} step={1} onValueChange={(v) => setCaContrast(v[0])} className="flex-1" />
                <span className="text-[9px] w-8 text-right">{caContrast > 0 ? `+${caContrast}` : caContrast}</span>
              </div>
              <div className="flex items-center gap-2">
                <Palette className="h-3 w-3 text-pink-400" />
                <span className="text-[9px] w-12">{locale === "ar" ? "التشبع" : "Saturat."}</span>
                <Slider value={[caSaturation]} min={-100} max={100} step={1} onValueChange={(v) => setCaSaturation(v[0])} className="flex-1" />
                <span className="text-[9px] w-8 text-right">{caSaturation > 0 ? `+${caSaturation}` : caSaturation}</span>
              </div>
              <div className="flex items-center gap-2">
                <Wand2 className="h-3 w-3 text-emerald-400" />
                <span className="text-[9px] w-12">{locale === "ar" ? "الحيوية" : "Vibrance"}</span>
                <Slider value={[caVibrance]} min={-100} max={100} step={1} onValueChange={(v) => setCaVibrance(v[0])} className="flex-1" />
                <span className="text-[9px] w-8 text-right">{caVibrance > 0 ? `+${caVibrance}` : caVibrance}</span>
              </div>
              <div className="flex items-center gap-2">
                <Sun className="h-3 w-3 text-orange-400" />
                <span className="text-[9px] w-12">{locale === "ar" ? "الحرارة" : "Temp"}</span>
                <Slider value={[caTemperature]} min={-100} max={100} step={1} onValueChange={(v) => setCaTemperature(v[0])} className="flex-1" />
                <span className="text-[9px] w-8 text-right">{caTemperature > 0 ? `+${caTemperature}` : caTemperature}</span>
              </div>
              <div className="flex items-center gap-2">
                <Droplet className="h-3 w-3 text-teal-400" />
                <span className="text-[9px] w-12">{locale === "ar" ? "الصبغة" : "Tint"}</span>
                <Slider value={[caTint]} min={-100} max={100} step={1} onValueChange={(v) => setCaTint(v[0])} className="flex-1" />
                <span className="text-[9px] w-8 text-right">{caTint > 0 ? `+${caTint}` : caTint}</span>
              </div>
              <button
                onClick={() => setCaShowAdvanced(!caShowAdvanced)}
                className="text-[9px] text-muted-foreground hover:text-cyan-accent flex items-center gap-1"
              >
                {caShowAdvanced ? "▼" : "▶"} {locale === "ar" ? "تعديلات متقدمة" : "Advanced"}
              </button>
              {caShowAdvanced && (
                <>
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-3 w-3 text-purple-400" />
                    <span className="text-[9px] w-12">{locale === "ar" ? "اللون" : "Hue"}</span>
                    <Slider value={[caHue]} min={-180} max={180} step={1} onValueChange={(v) => setCaHue(v[0])} className="flex-1" />
                    <span className="text-[9px] w-8 text-right">{caHue > 0 ? `+${caHue}°` : `${caHue}°`}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sun className="h-3 w-3 text-yellow-400" />
                    <span className="text-[9px] w-12">{locale === "ar" ? "التعريض" : "Exposure"}</span>
                    <Slider value={[caExposure]} min={-100} max={100} step={1} onValueChange={(v) => setCaExposure(v[0])} className="flex-1" />
                    <span className="text-[9px] w-8 text-right">{caExposure > 0 ? `+${caExposure}` : caExposure}</span>
                  </div>
                </>
              )}
              <div className="flex gap-1.5 pt-1">
                <Button
                  size="sm"
                  onClick={handleColorAdjust}
                  disabled={!image || busy !== null}
                  className="flex-1 h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90 font-semibold"
                >
                  {busy === "color-adjust" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sliders className="h-3.5 w-3.5" />}
                  {locale === "ar" ? "طبّق" : "Apply"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={resetColorAdjust}
                  disabled={busy !== null}
                  className="h-9 text-[11px] px-2"
                  title={locale === "ar" ? "إعادة الضبط" : "Reset"}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="text-[8px] text-muted-foreground px-1">
                {locale === "ar" ? "يعمل على الصورة كاملة. القيم تُطبَّق دفعة واحدة." : "Applies to whole image. All values apply at once."}
              </div>
            </CardContent>
          </Card>

          {/* Background Change */}
          <Card className="studio-panel border-panel-border">
            <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Palette className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "تغيير الخلفية" : "Background"}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-1">
                {(["preset","description","color"] as const).map((m) => (
                  <button key={m} onClick={() => setBgMode(m)} className={cn("px-2 py-1 rounded text-[10px]", bgMode === m ? "bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}>
                    {m === "preset" ? (locale === "ar" ? "مقترحة" : "Preset") : m === "description" ? (locale === "ar" ? "وصف" : "Text") : (locale === "ar" ? "لون" : "Color")}
                  </button>
                ))}
              </div>

              {bgMode === "preset" && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap gap-1">
                    {(["nature","indoor","urban","abstract"] as const).map((c) => (
                      <button key={c} onClick={() => setBgCat(c)} className={cn("px-2 py-0.5 rounded text-[9px]", bgCat === c ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30" : "bg-muted/20 text-muted-foreground")}>
                        {c === "nature" ? (locale === "ar" ? "طبيعة" : "Nature") : c === "indoor" ? (locale === "ar" ? "داخلي" : "Indoor") : c === "urban" ? (locale === "ar" ? "حضري" : "Urban") : (locale === "ar" ? "تجريبي" : "Abstract")}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1 max-h-[80px] overflow-y-auto">
                    {bgCat === "nature" && [{n:"forest",c:"#2d5016",l:locale==="ar"?"غابة":"Forest"},{n:"beach",c:"#87CEEB",l:locale==="ar"?"شاطئ":"Beach"},{n:"mountains",c:"#4a6fa5",l:locale==="ar"?"جبال":"Mount"},{n:"sunset",c:"#ff6b35",l:locale==="ar"?"غروب":"Sunset"},{n:"garden",c:"#5a9b5e",l:locale==="ar"?"حديقة":"Garden"},{n:"desert",c:"#c2a878",l:locale==="ar"?"صحراء":"Desert"}].map(p => (
                      <button key={p.n} onClick={() => setBgName(p.n)} className={cn("flex flex-col items-center gap-0.5 p-1 rounded text-[8px]", bgName === p.n ? "ring-1 ring-cyan-accent" : "")}>
                        <div className="h-6 w-full rounded" style={{ background: p.c }} /><span>{p.l}</span>
                      </button>
                    ))}
                    {bgCat === "indoor" && [{n:"studio",c:"#f0f0f0",l:locale==="ar"?"استوديو":"Studio"},{n:"livingRoom",c:"#3a2a1a",l:locale==="ar"?"معيشة":"Living"},{n:"office",c:"#2a3a4a",l:locale==="ar"?"مكتب":"Office"},{n:"bedroom",c:"#2a1a2a",l:locale==="ar"?"نوم":"Bed"},{n:"kitchen",c:"#3a3a3a",l:locale==="ar"?"مطبخ":"Kitchen"},{n:"library",c:"#3a2010",l:locale==="ar"?"مكتبة":"Library"}].map(p => (
                      <button key={p.n} onClick={() => setBgName(p.n)} className={cn("flex flex-col items-center gap-0.5 p-1 rounded text-[8px]", bgName === p.n ? "ring-1 ring-cyan-accent" : "")}>
                        <div className="h-6 w-full rounded" style={{ background: p.c }} /><span>{p.l}</span>
                      </button>
                    ))}
                    {bgCat === "urban" && [{n:"cityNight",c:"#0a0a2a",l:locale==="ar"?"ليل":"Night"},{n:"skyline",c:"#4a5a6a",l:locale==="ar"?"أفق":"Sky"},{n:"cafe",c:"#3a2a1a",l:locale==="ar"?"مقهى":"Cafe"},{n:"street",c:"#5a4a3a",l:locale==="ar"?"شارع":"Street"},{n:"subway",c:"#2a2a3a",l:locale==="ar"?"مترو":"Subway"},{n:"bridge",c:"#5a4a3a",l:locale==="ar"?"جسر":"Bridge"}].map(p => (
                      <button key={p.n} onClick={() => setBgName(p.n)} className={cn("flex flex-col items-center gap-0.5 p-1 rounded text-[8px]", bgName === p.n ? "ring-1 ring-cyan-accent" : "")}>
                        <div className="h-6 w-full rounded" style={{ background: p.c }} /><span>{p.l}</span>
                      </button>
                    ))}
                    {bgCat === "abstract" && [{n:"gradient1",c:"#2d1b4e",l:locale==="ar"?"بنسبجي":"Purple"},{n:"gradient2",c:"#1a3a4a",l:locale==="ar"?"أزرق":"Blue"},{n:"gradient3",c:"#ff8c00",l:locale==="ar"?"برتقالي":"Orange"},{n:"bokeh",c:"#1a1a2a",l:locale==="ar"?"بوكيه":"Bokeh"},{n:"geometric",c:"#2a1a4a",l:locale==="ar"?"هندسي":"Geo"},{n:"minimal",c:"#1a1a1a",l:locale==="ar"?"بسيط":"Minimal"}].map(p => (
                      <button key={p.n} onClick={() => setBgName(p.n)} className={cn("flex flex-col items-center gap-0.5 p-1 rounded text-[8px]", bgName === p.n ? "ring-1 ring-cyan-accent" : "")}>
                        <div className="h-6 w-full rounded" style={{ background: p.c }} /><span>{p.l}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {bgMode === "description" && (
                <textarea value={bgDescription} onChange={(e) => setBgDescription(e.target.value)} placeholder={locale === "ar" ? "اكتب وصف الخلفية..." : "Describe the background..."} className="w-full h-16 text-[10px] bg-black/30 border border-cyan-accent/30 rounded p-2 resize-none" />
              )}

              {bgMode === "color" && (
                <div className="flex items-center gap-2">
                  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-8 w-12 rounded cursor-pointer" />
                  <input type="text" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="h-8 flex-1 text-[10px] font-mono bg-black/30 border border-cyan-accent/30 rounded px-2" />
                </div>
              )}

              <Button size="sm" onClick={handleBackgroundChange} disabled={!image || busy !== null || (bgMode === "description" && !bgDescription.trim())} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">
                {busy === "bg-change" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
                {locale === "ar" ? "غيّر الخلفية" : "Change BG"}
              </Button>
            </CardContent>
          </Card>

          {/* CROP — interactive overlay */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Crop className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "اقتصاص" : "Crop"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <Button
              size="sm"
              onClick={() => {
                if (!image) return;
                // Re-measure the image bounding box (in case it resized since last load)
                const el = imgElRef.current;
                if (el) {
                  const r = el.getBoundingClientRect();
                  setImgDisplayRect({ width: r.width, height: r.height });
                }
                // Lock zoom to 1 when entering crop mode — CropOverlay uses
                // the unzoomed displayWidth/displayHeight, so zoom>1 would
                // misalign the overlay's coordinates with the actual image.
                setZoom(1);
                setCropMode(true);
              }}
              disabled={!image || busy !== null}
              className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90"
            >
              {busy === "crop" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crop className="h-3.5 w-3.5" />}
              {locale === "ar" ? "تحديد المنطقة ثم اقتصاص" : "Select area then crop"}
            </Button>
            {cropMode && (
              <p className="text-[10px] text-muted-foreground text-center">
                {locale === "ar" ? "ارسم مربعاً على الصورة ثم اضغط موافق" : "Draw a box on the image then click OK"}
              </p>
            )}
            {/* Advanced: manual numeric inputs (hidden by default, show when needed) */}
            <details className="text-[9px]">
              <summary className="cursor-pointer text-muted-foreground">{locale === "ar" ? "إدخال يدوي للأبعاد" : "Manual dimensions"}</summary>
              <div className="grid grid-cols-4 gap-1 mt-1">
                <div className="flex items-center gap-1"><span>L</span><input type="number" value={cropLeft} onChange={(e)=>setCropLeft(+e.target.value)} className="w-12 bg-black/30 border border-cyan-accent/20 rounded px-1" /></div>
                <div className="flex items-center gap-1"><span>T</span><input type="number" value={cropTop} onChange={(e)=>setCropTop(+e.target.value)} className="w-12 bg-black/30 border border-cyan-accent/20 rounded px-1" /></div>
                <div className="flex items-center gap-1"><span>W</span><input type="number" value={cropW} onChange={(e)=>setCropW(+e.target.value)} className="w-12 bg-black/30 border border-cyan-accent/20 rounded px-1" /></div>
                <div className="flex items-center gap-1"><span>H</span><input type="number" value={cropH} onChange={(e)=>setCropH(+e.target.value)} className="w-12 bg-black/30 border border-cyan-accent/20 rounded px-1" /></div>
              </div>
              <Button size="sm" onClick={() => void handleCrop(undefined)} disabled={!image || busy !== null} className="w-full h-8 text-[10px] mt-1">
                {locale === "ar" ? "اقتصاص بالأبعاد اليدوية" : "Crop with manual dims"}
              </Button>
            </details>
          </CardContent></Card>

          {/* ROTATE */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><RotateCw className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "تدوير" : "Rotate"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <div className="flex gap-1">{[90, 180, 270].map((a) => (<button key={a} onClick={() => setRotateAngle(a)} className={cn("px-2 py-1 rounded text-[10px]", rotateAngle === a ? "bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}>{a}deg</button>))}</div>
            <Button size="sm" onClick={handleRotate} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "rotate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}{locale === "ar" ? "دوّر" : "Rotate"}</Button>
          </CardContent></Card>

          {/* FLIP */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><FlipHorizontal className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "قلب" : "Flip"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <div className="flex gap-1"><button onClick={() => setFlipDir("horizontal")} className={cn("px-2 py-1 rounded text-[10px]", flipDir === "horizontal" ? "bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}><FlipHorizontal className="inline h-3 w-3" /> H</button><button onClick={() => setFlipDir("vertical")} className={cn("px-2 py-1 rounded text-[10px]", flipDir === "vertical" ? "bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}><FlipVertical className="inline h-3 w-3" /> V</button></div>
            <Button size="sm" onClick={handleFlip} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "flip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlipHorizontal className="h-3.5 w-3.5" />}{locale === "ar" ? "اقلب" : "Flip"}</Button>
          </CardContent></Card>

          {/* SHARPEN */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Focus className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "شحذ" : "Sharpen"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <div className="flex items-center gap-2"><Focus className="h-3 w-3" /><Slider value={[sharpenAmt]} min={0.1} max={5} step={0.1} onValueChange={(v) => setSharpenAmt(v[0])} className="flex-1" /><span className="text-[10px] w-8">{sharpenAmt}</span></div>
            <Button size="sm" onClick={handleSharpen} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "sharpen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Focus className="h-3.5 w-3.5" />}{locale === "ar" ? "اشحذ" : "Sharpen"}</Button>
          </CardContent></Card>

          {/* BLUR */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><CloudFog className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "ضبابي" : "Blur"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <div className="flex items-center gap-2"><CloudFog className="h-3 w-3" /><Slider value={[blurRadius]} min={0.3} max={50} step={0.5} onValueChange={(v) => setBlurRadius(v[0])} className="flex-1" /><span className="text-[10px] w-8">{blurRadius}</span></div>
            <Button size="sm" onClick={handleBlur} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "blur" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudFog className="h-3.5 w-3.5" />}{locale === "ar" ? "ضبّب" : "Blur"}</Button>
          </CardContent></Card>

          {/* FILTERS */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Sliders className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "فلاتر" : "Filters"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <div className="grid grid-cols-4 gap-1">{["grayscale", "sepia", "invert", "vintage", "cool", "warm", "noir", "vivid"].map((f) => (<button key={f} onClick={() => setFilterType(f)} className={cn("px-1 py-1 rounded text-[9px]", filterType === f ? "bg-cyan-accent/20 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}>{f}</button>))}</div>
            <Button size="sm" onClick={handleFilter} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "filter" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sliders className="h-3.5 w-3.5" />}{locale === "ar" ? "طبّق" : "Apply"}</Button>
          </CardContent></Card>

          {/* REMOVE BACKGROUND */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Eraser className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "إزالة خلفية" : "Remove BG"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <div className="flex items-center gap-2"><span className="text-[10px]">BG:</span><input type="color" value={rmBgColor} onChange={(e) => setRmBgColor(e.target.value)} className="h-8 w-12 rounded cursor-pointer" /></div>
            <Button size="sm" onClick={handleRemoveBg} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "rm-bg" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eraser className="h-3.5 w-3.5" />}{locale === "ar" ? "أزل الخلفية" : "Remove"}</Button>
          </CardContent></Card>

          {/* REMOVE OBJECT */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Eraser className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "إزالة كائن" : "Remove Obj"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <input type="text" value={rmObjDesc} onChange={(e) => setRmObjDesc(e.target.value)} placeholder={locale === "ar" ? "ما الذي تريد إزالته؟" : "What to remove?"} className="w-full h-8 text-[10px] bg-black/30 border border-cyan-accent/30 rounded px-2" />
            <Button size="sm" onClick={handleRemoveObj} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "rm-obj" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eraser className="h-3.5 w-3.5" />}{locale === "ar" ? "أزل الكائن" : "Remove"}</Button>
          </CardContent></Card>

          {/* WATERMARK */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Stamp className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "علامة مائية" : "Watermark"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <input type="text" value={wmText} onChange={(e) => setWmText(e.target.value)} placeholder="Text..." className="w-full h-8 text-[10px] bg-black/30 border border-cyan-accent/30 rounded px-2" />
            <div className="flex items-center gap-2"><Stamp className="h-3 w-3" /><Slider value={[wmOpacity]} min={10} max={100} step={5} onValueChange={(v) => setWmOpacity(v[0])} className="flex-1" /><span className="text-[10px] w-8">{wmOpacity}%</span></div>
            <Button size="sm" onClick={handleWatermark} disabled={!image || busy !== null} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "watermark" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stamp className="h-3.5 w-3.5" />}{locale === "ar" ? "أضف علامة" : "Stamp"}</Button>
          </CardContent></Card>

          {/* AI GENERATE — smart pipeline: يقرأ ← يحلل ← يفكر ← يولّد ← يدقّق */}
          <Card className="studio-panel border-panel-border"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Sparkles className="h-4 w-4" style={{ color: "var(--accent-cyan)" }} />{locale === "ar" ? "التوليد الذكي" : "Smart Generate"}</CardTitle></CardHeader><CardContent className="space-y-2">
            <textarea value={aiGenPrompt} onChange={(e) => setAiGenPrompt(e.target.value)} placeholder={locale === "ar" ? "اكتب طلبك بحرية — المولد الذكي يقرأه، يحلله، يفكر فيه، ثم يولّد صورة احترافية…" : "Describe freely — the smart engine reads, analyzes, thinks, then generates…"} className="w-full h-20 text-[10px] bg-black/30 border border-cyan-accent/30 rounded p-2 resize-none" />
            <div className="flex items-center gap-1">
              {(["1:1", "16:9", "9:16", "4:3", "3:4"] as const).map((a) => (
                <button key={a} onClick={() => setAiGenAspect(a)} className={`flex-1 h-6 rounded text-[9px] font-mono transition ${aiGenAspect === a ? "bg-cyan-accent/20 text-cyan-accent ring-1 ring-cyan-accent/50" : "bg-muted/30 text-muted-foreground hover:bg-muted/50"}`}>{a}</button>
              ))}
            </div>
            <Button size="sm" onClick={handleAiGenerate} disabled={busy !== null || !aiGenPrompt.trim()} className="w-full h-9 text-[11px] bg-cyan-accent text-black hover:bg-cyan-accent/90">{busy === "ai-gen" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{locale === "ar" ? "ولّد ذكياً" : "Smart Generate"}</Button>
            {busy === "ai-gen" && (
              <div className="space-y-1">
                {[
                  locale === "ar" ? "قراءة الطلب…" : "Reading request…",
                  locale === "ar" ? "تحليل العناصر والمشهد…" : "Analyzing subject & scene…",
                  locale === "ar" ? "التفكير بالإضاءة والتكوين والأسلوب…" : "Thinking: light, composition, style…",
                  locale === "ar" ? "توليد الصورة…" : "Generating image…",
                  locale === "ar" ? "تدقيق النتيجة وتقييمها…" : "Reviewing & scoring…",
                ].map((label, i) => (
                  <div key={i} className={`flex items-center gap-1.5 text-[9px] ${aiGenStage > i ? "text-cyan-accent" : "text-muted-foreground/50"}`}>
                    {aiGenStage > i + 1 ? "✓" : aiGenStage === i + 1 ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "○"}
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            )}
            {aiGenInfo && (
              <div className="rounded-md bg-black/30 border border-cyan-accent/20 p-2 space-y-1.5 text-[9px] leading-relaxed">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-cyan-accent">{locale === "ar" ? "تحليل الطلب" : "Request analysis"}</span>
                  <span className="font-mono text-emerald-400">{locale === "ar" ? `تقييم ${aiGenInfo.critiqueScore ?? "—"}/100` : `${aiGenInfo.critiqueScore ?? "—"}/100`}</span>
                </div>
                {aiGenInfo.understanding && <p><span className="text-cyan-accent/80">{locale === "ar" ? "الفهم:" : "Understood:"}</span> {aiGenInfo.understanding}</p>}
                {aiGenInfo.analysis && <p><span className="text-cyan-accent/80">{locale === "ar" ? "التحليل:" : "Analysis:"}</span> {aiGenInfo.analysis}</p>}
                {aiGenInfo.reasoning && <p><span className="text-cyan-accent/80">{locale === "ar" ? "التفكير:" : "Reasoning:"}</span> {aiGenInfo.reasoning}</p>}
                {aiGenInfo.enhancedPrompt && <p className="text-muted-foreground" dir="ltr"><span className="text-cyan-accent/80">Prompt:</span> {aiGenInfo.enhancedPrompt}</p>}
                <p className="text-muted-foreground/70">{aiGenInfo.thinker ? `${locale === "ar" ? "المفكر" : "Thinker"}: ${aiGenInfo.thinker} · ${locale === "ar" ? "المولد" : "Image"}: ${aiGenInfo.imageModel} · ${locale === "ar" ? "محاولات" : "Attempts"}: ${aiGenInfo.attempts}` : ""}</p>
              </div>
            )}
          </CardContent></Card>
        </div>
      
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3"><CardTitle className="text-sm">تحويلات الأنماط</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* ===== Source indicator — confirms the source is the top box =====
              Each click on a style button uses THIS image (the top box)
              as the source — never the previous style result. The previous
              result is fully replaced on each new click. */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-purple-500/5 border border-purple-500/15">
            <div className="relative h-10 w-10 rounded-md overflow-hidden ring-1 ring-purple-500/30 bg-black/30 shrink-0">
              {image ? (
                <img
                  src={image.url}
                  alt="source"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-purple-300/60">
                  <UploadCloud className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-purple-200 flex items-center gap-1.5">
                <UploadCloud className="h-3 w-3" />
                {locale === "ar" ? "المصدر: المربع العلوي" : "Source: top box"}
              </div>
              <div className="text-[10px] text-purple-300/60 truncate">
                {image
                  ? `${image.name} · ${image.width}×${image.height}`
                  : locale === "ar"
                    ? "ارفع صورة أولاً"
                    : "Upload an image first"}
              </div>
            </div>
            <div className="text-[9px] text-purple-300/50 text-right leading-tight hidden sm:block">
              {locale === "ar"
                ? "كل زر جديد يعمل من المصدر، لا من النتيجة السابقة"
                : "Each new button works from source, not from previous result"}
            </div>
          </div>

          {/* ===== Style-result preview box — below the main top image, same size ===== */}
          <div className="relative rounded-lg border border-purple-500/30 bg-black/30 overflow-hidden min-h-[400px] flex flex-col">
            {/* Header bar — with zoom controls + use-as-source + open/download/clear */}
            <div className="flex items-center justify-between px-3 py-2 bg-purple-500/10 border-b border-purple-500/20">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-purple-300" />
                <span className="text-xs font-semibold text-purple-200">
                  {locale === "ar" ? "نتيجة التحويل" : "Style Result"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {/* Zoom-out button */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-purple-200 hover:text-purple-100 hover:bg-purple-500/20 disabled:opacity-30"
                  onClick={() => setStyleZoom((z) => Math.max(1, z * 0.9))}
                  disabled={!styleResult}
                  title={locale === "ar" ? "تصغير (لا أصغر من الحجم الأصلي)" : "Zoom out (min = original size)"}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                {/* Zoom level indicator */}
                <span className="text-[10px] font-mono text-purple-200/80 min-w-[36px] text-center">
                  {Math.round(styleZoom * 100)}%
                </span>
                {/* Zoom-in button */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-purple-200 hover:text-purple-100 hover:bg-purple-500/20 disabled:opacity-30"
                  onClick={() => setStyleZoom((z) => Math.min(10, z * 1.1))}
                  disabled={!styleResult}
                  title={locale === "ar" ? "تكبير (حتى 1000%)" : "Zoom in (up to 1000%)"}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                {/* Reset zoom */}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-purple-200 hover:text-purple-100 hover:bg-purple-500/20 disabled:opacity-30"
                  onClick={() => setStyleZoom(1)}
                  disabled={!styleResult || styleZoom === 1}
                  title={locale === "ar" ? "إعادة الضبط" : "Reset zoom"}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
                <div className="w-px h-4 bg-purple-500/20 mx-1" />
                {styleResult && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-purple-200 hover:text-purple-100 hover:bg-purple-500/20"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          const t = window.open("", "_blank");
                          if (t) t.location.href = styleResult.url;
                        }
                      }}
                      title={locale === "ar" ? "فتح في نافذة جديدة" : "Open in new tab"}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-purple-200 hover:text-purple-100 hover:bg-purple-500/20"
                      onClick={() => {
                        if (typeof document === "undefined") return;
                        const a = document.createElement("a");
                        a.href = styleResult.url;
                        a.download = `style-${styleResult.style}-${styleResult.at}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      title={locale === "ar" ? "تنزيل" : "Download"}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                    {/* Use-as-source button — OPTIONAL: promotes this style
                        result to be the new top-box source. This is the
                        ONLY way the top box changes from below; the buttons
                        themselves never touch the top box. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-purple-200 hover:text-purple-100 hover:bg-purple-500/20"
                      onClick={() => {
                        if (!styleResult) return;
                        updateImage({
                          url: styleResult.url,
                          path: styleResult.path,
                          width: styleResult.width,
                          height: styleResult.height,
                        });
                        toast({
                          title: locale === "ar"
                            ? "تم استخدام نتيجة النمط كمصدر جديد"
                            : "Style result promoted to source",
                        });
                      }}
                      title={locale === "ar"
                        ? "استخدم هذه النتيجة كمصدر جديد في المربع العلوي"
                        : "Use this result as the new top-box source"}
                    >
                      <UploadCloud className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-purple-200 hover:text-purple-100 hover:bg-purple-500/20"
                      onClick={() => { setStyleResult(null); setStyleZoom(1); }}
                      title={locale === "ar" ? "مسح النتيجة" : "Clear result"}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Image area — same height as the main top box (h-[500px]) and supports scroll when zoomed in */}
            <div
              className="flex-1 relative overflow-auto bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.04),transparent)]"
              style={{ height: "500px", cursor: styleZoom > 1 && styleResult ? "grab" : "default" }}
            >
              {busy && busy.startsWith("style-") ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-purple-300 gap-2">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <div className="text-xs">
                    {locale === "ar"
                      ? `جارٍ التحويل إلى ${([["3d","3D"],["anime","أنمي"],["cartoon","كرتون"],["oil","زيتي"],["watercolor","مائية"],["sketch","سكتش"],["pixel","بكسل"],["digital","رقمي"]].find((x) => `style-${x[0]}` === busy)?.[1]) || ""}...`
                      : `Converting to ${busy.slice(6)}...`}
                  </div>
                </div>
              ) : styleResult ? (
                <div
                  className="min-h-full min-w-full flex items-center justify-center p-2"
                  style={{
                    // Apply zoom via CSS transform. When zoomed in, the inner
                    // div grows so the parent scrolls naturally.
                    transform: `scale(${styleZoom})`,
                    transformOrigin: "center center",
                    transition: "transform 0.15s ease-out",
                  }}
                >
                  <img
                    src={styleResult.url}
                    alt={`style-${styleResult.style}`}
                    className="max-w-full max-h-[480px] object-contain rounded-md"
                    style={{ imageRendering: styleResult.style === "pixel" ? "pixelated" : "auto" }}
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-purple-300/60 gap-2 text-center">
                  <Sparkles className="h-8 w-8 opacity-50" />
                  <div className="text-xs">
                    {locale === "ar"
                      ? "اضغط أحد الأزرار بالأسفل لرؤية النتيجة هنا"
                      : "Click any style button below to see the result here"}
                  </div>
                </div>
              )}
            </div>

            {/* Footer info bar */}
            {styleResult && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-black/30 border-t border-purple-500/10 text-[10px] text-purple-200/80">
                <span className="font-mono">
                  {styleResult.width}×{styleResult.height}
                </span>
                <span className="truncate max-w-[120px]">
                  {locale === "ar" ? `نمط: ${styleResult.styleLabel}` : `Style: ${styleResult.styleLabel}`}
                </span>
                <span className="font-mono">
                  {new Date(styleResult.at).toLocaleTimeString(locale === "ar" ? "ar-SA" : "en-US")}
                </span>
              </div>
            )}
          </div>

          {/* ===== 8 style buttons — directly below the result box, 4 per row, each with an emoji ===== */}
          <div className="grid grid-cols-4 gap-2">
            {([
              ["3d","3D","🧊"],
              ["anime","أنمي","🌸"],
              ["cartoon","كرتون","🎨"],
              ["oil","زيتي","🖼️"],
              ["watercolor","مائية","💧"],
              ["sketch","سكتش","✏️"],
              ["pixel","بكسل","🎮"],
              ["digital","رقمي","💻"],
            ] as const).map(([style, label, emoji]) => (
              <Button key={style} size="sm" onClick={async () => {
                const imagePath = image?.path || image?.url || "";
                if (!imagePath) { alert("ارفع صورة أولاً"); return; }
                setBusy(`style-${style}`);
                try {
                  const r = await fetch("/api/images/style-transform", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ image: imagePath, style })
                  });
                  const d = await r.json();
                  if (r.ok && d.ok && d.url) {
                    // IMPORTANT: style-transform results do NOT update the main
                    // top preview box. They only update the dedicated style-result
                    // preview box below. The top box stays with whatever image
                    // the user originally uploaded (or whatever the upper-section
                    // tools like Enhance/Colorize changed it to).
                    setStyleZoom(1);
                    setStyleResult({
                      url: d.url,
                      path: d.path,
                      width: d.width ?? image?.width ?? 0,
                      height: d.height ?? image?.height ?? 0,
                      style,
                      styleLabel: label,
                      at: Date.now(),
                    });
                    toast({ title: locale === "ar" ? `تم التحويل إلى ${label}` : `Converted to ${label}` });
                  } else {
                    toast({ title: "Error", description: d?.message || d?.error || "فشل", variant: "destructive" });
                  }
                } catch(e) {
                  toast({ title: "Error", description: e instanceof Error ? e.message : "خطأ", variant: "destructive" });
                } finally {
                  setBusy(null);
                }
              }}
              disabled={!image || busy !== null}
              className="h-14 text-[11px] bg-purple-500/10 hover:bg-purple-500/20 text-purple-200 border border-purple-500/30 flex flex-col items-center justify-center gap-0.5">
                <span className="text-base leading-none">
                  {busy === `style-${style}` ? <Loader2 className="h-3.5 w-3.5 animate-spin inline-block" /> : emoji}
                </span>
                <span className="leading-none">
                  {locale === "ar" ? `${label}` : `${label}`}
                </span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ============================================================ */}
      {/* ====== Age Transformations — 6 age presets, 3 per row ====== */}
      {/* ============================================================ */}
      <Card className="studio-panel border-panel-border">
        <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-400" />
          {locale === "ar" ? "تحويلات العمر" : "Age Transformations"}
        </CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* ===== Source indicator — confirms the source is the top box =====
              Each click on an age button uses THIS image (the top box)
              as the source — never the previous age result. The previous
              result is fully replaced on each new click. */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-md bg-amber-500/5 border border-amber-500/15">
            <div className="relative h-10 w-10 rounded-md overflow-hidden ring-1 ring-amber-500/30 bg-black/30 shrink-0">
              {image ? (
                <img
                  src={image.url}
                  alt="source"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-amber-300/60">
                  <UploadCloud className="h-4 w-4" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-amber-200 flex items-center gap-1.5">
                <UploadCloud className="h-3 w-3" />
                {locale === "ar" ? "المصدر: المربع العلوي" : "Source: top box"}
              </div>
              <div className="text-[10px] text-amber-300/60 truncate">
                {image
                  ? `${image.name} · ${image.width}×${image.height}`
                  : locale === "ar"
                    ? "ارفع صورة أولاً"
                    : "Upload an image first"}
              </div>
            </div>
            <div className="text-[9px] text-amber-300/50 text-right leading-tight hidden sm:block">
              {locale === "ar"
                ? "كل زر جديد يعمل من المصدر، لا من النتيجة السابقة"
                : "Each new button works from source, not from previous result"}
            </div>
          </div>

          {/* ===== Age-result preview box — same size as the main top image ===== */}
          <div className="relative rounded-lg border border-amber-500/30 bg-black/30 overflow-hidden min-h-[400px] flex flex-col">
            {/* Header bar — with zoom controls + open/download/clear */}
            <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
              <div className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-amber-300" />
                <span className="text-xs font-semibold text-amber-200">
                  {locale === "ar" ? "نتيجة تحويل العمر" : "Age Result"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-amber-200 hover:text-amber-100 hover:bg-amber-500/20 disabled:opacity-30"
                  onClick={() => setAgeZoom((z) => Math.max(1, z * 0.9))}
                  disabled={!ageResult}
                  title={locale === "ar" ? "تصغير" : "Zoom out"}
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </Button>
                <span className="text-[10px] font-mono text-amber-200/80 min-w-[36px] text-center">
                  {Math.round(ageZoom * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-amber-200 hover:text-amber-100 hover:bg-amber-500/20 disabled:opacity-30"
                  onClick={() => setAgeZoom((z) => Math.min(10, z * 1.1))}
                  disabled={!ageResult}
                  title={locale === "ar" ? "تكبير" : "Zoom in"}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-amber-200 hover:text-amber-100 hover:bg-amber-500/20 disabled:opacity-30"
                  onClick={() => setAgeZoom(1)}
                  disabled={!ageResult || ageZoom === 1}
                  title={locale === "ar" ? "إعادة الضبط" : "Reset zoom"}
                >
                  <RotateCw className="h-3.5 w-3.5" />
                </Button>
                <div className="w-px h-4 bg-amber-500/20 mx-1" />
                {ageResult && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-amber-200 hover:text-amber-100 hover:bg-amber-500/20"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          const t = window.open("", "_blank");
                          if (t) t.location.href = ageResult.url;
                        }
                      }}
                      title={locale === "ar" ? "فتح في نافذة جديدة" : "Open in new tab"}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-amber-200 hover:text-amber-100 hover:bg-amber-500/20"
                      onClick={() => {
                        if (typeof document === "undefined") return;
                        const a = document.createElement("a");
                        a.href = ageResult.url;
                        a.download = `age-${ageResult.age}-${ageResult.at}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      title={locale === "ar" ? "تنزيل" : "Download"}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                    {/* Use-as-source button — OPTIONAL: promotes this age
                        result to be the new top-box source. This is the
                        ONLY way the top box changes from below; the age
                        buttons themselves never touch the top box. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-amber-200 hover:text-amber-100 hover:bg-amber-500/20"
                      onClick={() => {
                        if (!ageResult) return;
                        updateImage({
                          url: ageResult.url,
                          path: ageResult.path,
                          width: ageResult.width,
                          height: ageResult.height,
                        });
                        toast({
                          title: locale === "ar"
                            ? "تم استخدام نتيجة العمر كمصدر جديد"
                            : "Age result promoted to source",
                        });
                      }}
                      title={locale === "ar"
                        ? "استخدم هذه النتيجة كمصدر جديد في المربع العلوي"
                        : "Use this result as the new top-box source"}
                    >
                      <UploadCloud className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-amber-200 hover:text-amber-100 hover:bg-amber-500/20"
                      onClick={() => { setAgeResult(null); setAgeZoom(1); }}
                      title={locale === "ar" ? "مسح النتيجة" : "Clear result"}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Image area — same height as the main top box */}
            <div
              className="flex-1 relative overflow-auto bg-[radial-gradient(circle_at_center,rgba(245,158,11,0.04),transparent)]"
              style={{ height: "500px", cursor: ageZoom > 1 && ageResult ? "grab" : "default" }}
            >
              {busy && busy.startsWith("age-") ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-300 gap-2">
                  <Loader2 className="h-8 w-8 animate-spin" />
                  <div className="text-xs">
                    {locale === "ar"
                      ? `جارٍ التحويل إلى ${([
                          ["child","طفل","4-10"],
                          ["teenager","يافع","12-18"],
                          ["young-adult","شاب","20-40"],
                          ["middle-aged","شيخ","45-60"],
                          ["elderly","شايب","65-100"],
                          ["ancient","كهل","110-150"],
                        ] as const).find((x) => `age-${x[0]}` === busy)?.[1] ?? ""}...`
                      : `Converting to ${busy.slice(4)}...`}
                  </div>
                </div>
              ) : ageResult ? (
                <div
                  className="min-h-full min-w-full flex items-center justify-center p-2"
                  style={{
                    transform: `scale(${ageZoom})`,
                    transformOrigin: "center center",
                    transition: "transform 0.15s ease-out",
                  }}
                >
                  <img
                    src={ageResult.url}
                    alt={`age-${ageResult.age}`}
                    className="max-w-full max-h-[480px] object-contain rounded-md"
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-300/60 gap-2 text-center">
                  <Users className="h-8 w-8 opacity-50" />
                  <div className="text-xs">
                    {locale === "ar"
                      ? "اضغط أحد أزرار العمر بالأسفل لرؤية النتيجة هنا"
                      : "Click any age button below to see the result here"}
                  </div>
                </div>
              )}
            </div>

            {/* Footer info bar */}
            {ageResult && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-black/30 border-t border-amber-500/10 text-[10px] text-amber-200/80">
                <span className="font-mono">
                  {ageResult.width}×{ageResult.height}
                </span>
                <span className="truncate max-w-[260px]">
                  {locale === "ar"
                    ? `${ageResult.gender === "female" ? "أنثى" : ageResult.gender === "male" ? "ذكر" : ""} ${ageResult.gender ? "· " : ""}${ageResult.ageLabel} (${ageResult.ageRange} سنة)`
                    : `${ageResult.gender ?? ""}${ageResult.gender ? " · " : ""}${ageResult.ageLabel} (${ageResult.ageRange} years)}`}
                </span>
                <span className="font-mono">
                  {new Date(ageResult.at).toLocaleTimeString(locale === "ar" ? "ar-SA" : "en-US")}
                </span>
              </div>
            )}
          </div>

          {/* ===== 6 age buttons — 3 per row, each with an emoji + age range ===== */}
          <div className="grid grid-cols-3 gap-2">
            {([
              ["child", "طفل", "4-10", "🧒"],
              ["teenager", "يافع", "12-18", "🧑"],
              ["young-adult", "شاب", "20-40", "👨"],
              ["middle-aged", "شيخ", "45-60", "🧔"],
              ["elderly", "شايب", "65-100", "👴"],
              ["ancient", "كهل", "110-150", "🧓"],
            ] as const).map(([ageKey, label, range, emoji]) => (
              <Button
                key={ageKey}
                size="sm"
                onClick={async () => {
                  const imagePath = image?.path || image?.url || "";
                  if (!imagePath) {
                    toast({ title: locale === "ar" ? "ارفع صورة أولاً" : "Upload an image first", variant: "destructive" });
                    return;
                  }
                  setBusy(`age-${ageKey}`);
                  try {
                    const r = await fetch("/api/images/age-transform", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ image: imagePath, age: ageKey }),
                    });
                    const d = await r.json();
                    if (r.ok && d.ok && d.url) {
                      // IMPORTANT: age-transform results do NOT update the main
                      // top preview box. They only update the dedicated age-result
                      // preview box. The top box stays with whatever image the
                      // user originally uploaded.
                      setAgeZoom(1);
                      setAgeResult({
                        url: d.url,
                        path: d.path,
                        width: d.width ?? image?.width ?? 0,
                        height: d.height ?? image?.height ?? 0,
                        age: ageKey,
                        ageLabel: label,
                        ageRange: range,
                        gender: d.gender ?? null,
                        at: Date.now(),
                      });
                      toast({
                        title: locale === "ar"
                          ? `تم التحويل إلى ${label} (${range} سنة)${d.gender ? ` · ${d.gender === "male" ? "ذكر" : "أنثى"}` : ""}`
                          : `Converted to ${label} (${range} years)${d.gender ? ` · ${d.gender}` : ""}`,
                      });
                    } else {
                      toast({
                        title: "Error",
                        description: d?.message || d?.error || "فشل",
                        variant: "destructive",
                      });
                    }
                  } catch (e) {
                    toast({
                      title: "Error",
                      description: e instanceof Error ? e.message : "خطأ",
                      variant: "destructive",
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
                disabled={!image || busy !== null}
                className="h-16 text-[11px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 border border-amber-500/30 flex flex-col items-center justify-center gap-0.5"
              >
                <span className="text-lg leading-none">
                  {busy === `age-${ageKey}` ? <Loader2 className="h-3.5 w-3.5 animate-spin inline-block" /> : emoji}
                </span>
                <span className="leading-none font-medium">
                  {label}
                </span>
                <span className="text-[9px] leading-none text-amber-200/60">
                  {range} {locale === "ar" ? "سنة" : "yrs"}
                </span>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* === IMAGE CONVERT (format conversion + enhancement) === */}
      <Card className="studio-panel border-cyan-accent/30">
        <CardHeader className="py-2"><CardTitle className="text-sm flex items-center gap-2"><ArrowRight className="h-4 w-4 text-cyan-accent" />{isAr ? "وكيل تحويل صيغة الصورة" : "Image Convert"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>{isAr ? "ارفع الصورة" : "Upload Image"}</span>
                  <span className="text-[9px] text-emerald-500 font-normal">{isAr ? "بلا حدود" : "No size limit"}</span>
                </Label>
                <div className="relative">
                  {!imgConvFile ? (
                    <div onClick={() => imgConvInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[120px] rounded-md bg-black/30 border border-dashed border-cyan-accent/30 hover:bg-black/40 transition-colors">
                      <UploadCloud className="h-8 w-8 text-cyan-accent" />
                      <p className="text-xs mt-2">{isAr ? "ارفع أي صورة" : "Upload any image"}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {isAr ? "JPG، PNG، WebP، GIF، BMP، TIFF، AVIF، HEIC، ICO..." : "JPG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC, ICO..."}
                      </p>
                      <input
                        ref={imgConvInputRef}
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif,.avif,.heic,.heif,.ico,.psd,.tga,.ppm,.pgm,.pbm"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setImgConvFile(f);
                            setImgConvResult(null);
                            setImgConvProgress(null);
                          }
                          e.target.value = "";
                        }}
                      />
                    </div>
                  ) : (
                    <div className="relative rounded overflow-hidden bg-black/50">
                      <img src={URL.createObjectURL(imgConvFile)} alt="preview" className="w-full max-h-[180px] object-contain" />
                      <button onClick={() => { setImgConvFile(null); setImgConvResult(null); setImgConvProgress(null); }} className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center z-10">
                        <X className="h-3.5 w-3.5 text-white" />
                      </button>
                      <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/70 text-[10px] text-white/80">
                        {imgConvFile.name} · {fmtBytes(imgConvFile.size)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "الصيغة المستهدفة" : "Target Format"}</Label>
                <select
                  value={imgConvTargetFormat}
                  onChange={e => setImgConvTargetFormat(e.target.value)}
                  className="w-full h-9 px-2 rounded-md bg-black/30 border border-cyan-accent/30 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-accent"
                >
                  {IMAGE_FORMATS_LIST.map(f => (
                    <option key={f.value} value={f.value} className="bg-background text-foreground">
                      {f.label}
                    </option>
                  ))}
                </select>
                <p className="text-[9px] text-muted-foreground">
                  {isAr ? "17 صيغة مدعومة: JPG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC, ICO, PSD, TGA, PPM, PGM, PBM" : "17 formats: JPG, PNG, WebP, GIF, BMP, TIFF, AVIF, HEIC, ICO, PSD, TGA, PPM, PGM, PBM"}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "مستوى الجودة" : "Quality Level"}</Label>
                <div className="grid grid-cols-4 gap-1">
                  {IMG_QUALITY_LEVELS.map(q => (
                    <button
                      key={q.value}
                      onClick={() => setImgConvQuality(q.value)}
                      className={cn("py-1.5 rounded text-[10px] font-medium", imgConvQuality === q.value ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                    >
                      {isAr ? q.ar : q.en}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "معامل التكبير" : "Upscale Factor"}</Label>
                <div className="grid grid-cols-5 gap-1">
                  {IMG_UPSCALE_FACTORS.map(u => (
                    <button
                      key={u.value}
                      onClick={() => setImgConvUpscale(u.value)}
                      className={cn("py-1.5 rounded text-[10px] font-medium", imgConvUpscale === u.value ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                    >
                      {u.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "خيارات التحسين" : "Enhancement Options"}</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { state: imgConvSharpen, set: setImgConvSharpen, ar: "زيادة الحدة", en: "Sharpen", icon: "🔬" },
                    { state: imgConvDenoise, set: setImgConvDenoise, ar: "إزالة الضوضاء", en: "Denoise", icon: "🔇" },
                    { state: imgConvColorEnhance, set: setImgConvColorEnhance, ar: "تحسين الألوان", en: "Color Enhance", icon: "🎨" },
                    { state: imgConvBoost, set: setImgConvBoost, ar: "تعزيز التباين", en: "Boost", icon: "⚡" },
                    { state: imgConvNormalize, set: setImgConvNormalize, ar: "موازنة المستويات", en: "Normalize", icon: "📊" },
                  ].map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => opt.set(!opt.state)}
                      className={cn("flex items-center gap-1.5 py-1.5 px-2 rounded text-[10px]", opt.state ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                    >
                      <span>{opt.icon}</span>
                      {isAr ? opt.ar : opt.en}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleImageConvert} disabled={!imgConvFile || !!busy} className="flex-1 h-10 text-sm bg-cyan-accent text-black hover:bg-cyan-accent/90">
                  {busy === "img-convert" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {isAr ? "حوّل الصورة" : "Convert Image"}
                </Button>
                {busy === "img-convert" && (
                  <Button variant="outline" onClick={handleCancelImgConvert} className="h-10 px-3 text-red-400">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {imgConvProgress && (
                <div className="space-y-2 p-3 rounded-md bg-muted/40 ring-1 ring-cyan-accent/20">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium">
                      {imgConvProgress.phase === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-accent" />}
                      <span>{imgConvProgress.phase === "uploading" ? (isAr ? "جارٍ الرفع" : "Uploading") : imgConvProgress.phase === "done" ? (isAr ? "اكتمل" : "Done") : (isAr ? "جارٍ المعالجة" : "Processing")}</span>
                    </div>
                    <span className="text-xs font-mono text-cyan-accent">{imgConvProgress.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn("h-full transition-all duration-300", imgConvProgress.phase === "done" ? "bg-emerald-500" : imgConvProgress.phase === "error" ? "bg-red-500" : "bg-gradient-to-r from-cyan-500 to-cyan-accent")} style={{ width: `${imgConvProgress.progress}%` }} />
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span>{isAr ? "تم:" : "Done:"}</span>
                      <span className="font-mono">{fmtBytes(imgConvProgress.bytesReceived)}</span>
                      <span className="text-muted-foreground/60">/ {fmtBytes(imgConvProgress.bytesTotal)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3 text-cyan-accent" />
                      <span className="font-mono">{imgConvProgress.speedMBs?.toFixed(2) || "—"} MB/s</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-cyan-accent" />
                      <span>{isAr ? "المنقضي:" : "Elapsed:"}</span>
                      <span className="font-mono">{fmtTime(imgConvProgress.elapsedSeconds)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-amber-500" />
                      <span>{isAr ? "المتبقي:" : "ETA:"}</span>
                      <span className="font-mono">{fmtTime(imgConvProgress.etaSeconds)}</span>
                    </div>
                  </div>
                </div>
              )}

              {imgConvResult && (
                <div className="space-y-2">
                  <div className="rounded overflow-hidden bg-black/50 ring-1 ring-cyan-accent/30">
                    <img src={imgConvResult.url} alt="converted" className="w-full max-h-[220px] object-contain" />
                  </div>
                  <div className="p-2 rounded-md bg-muted/30 text-[10px] text-muted-foreground space-y-0.5">
                    <p>{imgConvResult.note || (isAr ? "تم التحويل" : "Converted")}</p>
                    <p>{isAr ? "الأداة:" : "Tool:"} {imgConvResult.method}</p>
                    <p>{isAr ? "الحجم الأصلي:" : "Original:"} {fmtBytes(imgConvResult.originalSize)}</p>
                    <p>{isAr ? "الحجم المحوّل:" : "Converted:"} {fmtBytes(imgConvResult.convertedSize)}</p>
                    {imgConvResult.width > 0 && <p>{isAr ? "الأبعاد:" : "Dimensions:"} {imgConvResult.width}×{imgConvResult.height}</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => {
                      const a = document.createElement("a");
                      a.href = imgConvResult.url;
                      a.download = `converted-${Date.now()}.${imgConvResult.format}`;
                      a.click();
                    }} className="h-8">
                      <Download className="h-3.5 w-3.5" />
                      <span className="text-xs ml-1">{isAr ? "تحميل" : "Download"}</span>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setImgConvResult(null); setImgConvProgress(null); }} className="h-8 text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
</div>
    </div>
  );
}
