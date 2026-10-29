"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Loader2, UploadCloud, Download, Trash2, X, Sparkles, RefreshCw, Sun, Settings, Clock, Zap, CheckCircle2, Scissors, Film, Hash, Timer, Plus, Merge, Crop, AlertTriangle, ArrowRight, Users, Shirt, Link2, ArrowLeft, ScanFace } from "lucide-react";
import { SessionToolbar } from "@/components/shared/session-toolbar";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type VQ = "hd" | "fullHd" | "twoK" | "fourK" | "eightK" | "ultra";

const QL: Record<VQ, { ar: string; en: string; tag: string }> = {
  hd: { ar: "HD", en: "HD", tag: "720p" },
  fullHd: { ar: "فول HD", en: "FHD", tag: "1080p" },
  twoK: { ar: "2K", en: "2K", tag: "1440p" },
  fourK: { ar: "4K", en: "4K", tag: "2160p" },
  eightK: { ar: "8K", en: "8K", tag: "4320p" },
  ultra: { ar: "ULTRA", en: "ULTRA", tag: "8K+" },
};

// Accept ALL video formats including 3GP, with no size limit
const ACCEPT_ATTR = "video/*,.mp4,.3gp,.3gpp,.3g2,.avi,.mov,.mkv,.webm,.ogv,.flv,.wmv,.m4v,.ts,.mpeg,.mpg,.m2ts,.vob,.mts";

// Video formats that browsers can play in <video> element
const PLAYABLE = /\.(mp4|webm|mov|m4v|ogg)$/i;
// .3gp, .avi, .mkv, .flv, .wmv, .ts, etc. can't be played in browser → show poster instead

// Split options
const SPLIT_DURATIONS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const SPLIT_COUNTS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100];
const fmtDur = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${s / 60}m` : `${s / 3600}h`);

// Merge transition options
const TRANSITIONS: { value: string; ar: string; en: string; icon: string }[] = [
  { value: "none", ar: "بدون", en: "None", icon: "➖" },
  { value: "fade", ar: "تلاشي", en: "Fade", icon: "🌫️" },
  { value: "slide", ar: "انزلاق", en: "Slide", icon: "➡️" },
  { value: "wipe", ar: "مسح", en: "Wipe", icon: "🧹" },
  { value: "dissolve", ar: "ذوبان", en: "Dissolve", icon: "💫" },
];

// Video conversion formats (full list)
const VIDEO_FORMATS = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "mkv", label: "MKV" },
  { value: "mov", label: "MOV (QuickTime)" },
  { value: "avi", label: "AVI" },
  { value: "flv", label: "FLV (Flash)" },
  { value: "wmv", label: "WMV (Windows)" },
  { value: "m4v", label: "M4V (iTunes)" },
  { value: "3gp", label: "3GP (Mobile)" },
  { value: "3g2", label: "3G2 (Mobile)" },
  { value: "ogv", label: "OGV (Ogg)" },
  { value: "ts", label: "TS (MPEG-TS)" },
  { value: "mpeg", label: "MPEG" },
  { value: "mpg", label: "MPG" },
  { value: "m2ts", label: "M2TS (Blu-ray)" },
  { value: "vob", label: "VOB (DVD)" },
  { value: "mts", label: "MTS (AVCHD)" },
  { value: "gif", label: "GIF (animated)" },
  { value: "mjpeg", label: "MJPEG" },
  { value: "f4v", label: "F4V (Flash)" },
  { value: "asf", label: "ASF (Windows)" },
];

const QUALITY_LEVELS = [
  { value: "low", ar: "سريع", en: "Fast" },
  { value: "medium", ar: "متوسط", en: "Medium" },
  { value: "high", ar: "عالي", en: "High" },
  { value: "ultra", ar: "أقصى", en: "Ultra" },
];

const UPSCALE_FACTORS = [
  { value: "1", label: "1× (بدون)" },
  { value: "1.5", label: "1.5×" },
  { value: "2", label: "2×" },
  { value: "3", label: "3×" },
  { value: "4", label: "4×" },
];


interface UploadProgressState {
  phase: "uploading" | "processing" | "done" | "error";
  progress: number;
  bytesReceived?: number;
  bytesTotal?: number;
  elapsedSeconds?: number;
  etaSeconds?: number;
  speedMBs?: number;
}

function fmtBytes(n?: number) {
  if (!n || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtTime(s?: number) {
  if (!s || s < 0) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}h ${min}m`;
}

export function VideoEditorPanel() {
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const isAr = locale === "ar";
  const [quality, setQuality] = useState<VQ>("fullHd");
  const [busy, setBusy] = useState<string | null>(null);
  const [enhanceFile, setEnhanceFile] = useState<File | null>(null);
  const [enhanceQuality, setEnhanceQuality] = useState<VQ>("fourK");
  const [enhanceResult, setEnhanceResult] = useState<any>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const enhanceInputRef = useRef<HTMLInputElement>(null);
  // Generate progress (for video generation)
  // Split state
  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [splitMode, setSplitMode] = useState<"duration" | "count">("duration");
  const [splitDuration, setSplitDuration] = useState<number>(60);
  const [splitCount, setSplitCount] = useState<number>(5);
  const [splitResult, setSplitResult] = useState<any>(null);
  const [splitProgress, setSplitProgress] = useState<UploadProgressState | null>(null);
  const splitInputRef = useRef<HTMLInputElement>(null);


  /**
   * Upload the file using XMLHttpRequest to get upload progress events.
   * Uses the raw-byte streaming endpoint (?filename=&quality=&size=) to support
   * unlimited file sizes (no FormData memory overhead).
   */
  const handleEnhance = useCallback(() => {
    if (!enhanceFile) return;
    setBusy("enhance");
    const startTime = Date.now();

    // Use raw byte stream for unlimited size — metadata goes in query params
    const url = `/api/video/enhance?filename=${encodeURIComponent(enhanceFile.name)}&quality=${enhanceQuality}&size=${enhanceFile.size}`;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.responseType = "json";

    // === Upload progress (XHR provides upload.progress events) ===
    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMBs = elapsedSec > 0 ? (e.loaded / 1024 / 1024) / elapsedSec : 0;
      const etaSec = speedMBs > 0 ? (e.total - e.loaded) / 1024 / 1024 / speedMBs : 0;
      setUploadProgress({
        phase: "uploading",
        progress: Math.round((e.loaded / e.total) * 50),  // upload phase = 0-50%
        bytesReceived: e.loaded,
        bytesTotal: e.total,
        elapsedSeconds: elapsedSec,
        etaSeconds: etaSec,
        speedMBs: parseFloat(speedMBs.toFixed(2)),
      });
    });

    xhr.upload.addEventListener("error", () => {
      setUploadProgress({ phase: "error", progress: 0 });
      toast({ title: isAr ? "فشل الرفع" : "Upload failed", variant: "destructive" });
      setBusy(null);
    });

    xhr.upload.addEventListener("abort", () => {
      setUploadProgress({ phase: "error", progress: 0 });
      toast({ title: isAr ? "ألغي الرفع" : "Upload aborted", variant: "destructive" });
      setBusy(null);
    });

    // === After upload completes, get taskId and poll for enhancement progress ===
    xhr.addEventListener("load", () => {
      let d: any;
      try { d = xhr.response; } catch { d = null; }
      if (!d || !d.taskId) {
        setUploadProgress({ phase: "error", progress: 0 });
        toast({ title: "Error", description: d?.message || "No taskId", variant: "destructive" });
        setBusy(null);
        return;
      }

      const taskId = d.taskId;
      const pollStart = Date.now();
      // Poll task status — enhancement phase = 50-100%
      const poll = async () => {
        for (let i = 0; i < 1200; i++) {  // up to 20 minutes for enhancement
          await new Promise(r => setTimeout(r, 1000));
          try {
            const pr = await fetch(`/api/task/status?id=${taskId}`);
            const pd = await pr.json();
            if (pd.status === "done" && pd.result) {
              setEnhanceResult(pd.result);
              setUploadProgress({ phase: "done", progress: 100 });
              toast({ title: isAr ? "✅ تم التحسين" : "✅ Enhanced" });
              setBusy(null);
              return;
            }
            if (pd.status === "error") {
              setUploadProgress({ phase: "error", progress: pd.progress || 0 });
              toast({ title: "Error", description: pd.error, variant: "destructive" });
              setBusy(null);
              return;
            }
            // Update progress (enhancement phase = 50-100%)
            const taskElapsed = (Date.now() - pollStart) / 1000;
            // Estimate ETA based on current progress rate
            const currentProgress = pd.progress || 50;
            const enhanceProgress = Math.max(0, currentProgress - 50);
            const etaSec = enhanceProgress > 0 ? (taskElapsed / enhanceProgress) * (50 - enhanceProgress) : 0;
            setUploadProgress({
              phase: pd.phase === "uploading" ? "uploading" : "processing",
              progress: currentProgress,
              bytesReceived: pd.bytesReceived,
              bytesTotal: pd.bytesTotal,
              elapsedSeconds: Math.round(taskElapsed),
              etaSeconds: Math.round(etaSec),
              speedMBs: pd.speedMBs,
            });
          } catch {}
        }
        setUploadProgress({ phase: "error", progress: 0 });
        toast({ title: isAr ? "انتهى الوقت" : "Timed out", variant: "destructive" });
        setBusy(null);
      };
      void poll();
    });

    xhr.addEventListener("error", () => {
      setUploadProgress({ phase: "error", progress: 0 });
      toast({ title: "Network error", variant: "destructive" });
      setBusy(null);
    });

    // Send the file as raw bytes (NOT FormData) — supports unlimited size
    xhr.send(enhanceFile);
  }, [enhanceFile, enhanceQuality, isAr, toast]);

  // === Helper to render the progress UI (reusable for enhance + split + generate) ===
  const renderProgress = (state: UploadProgressState | null, busyKey: string | null) => {
    if (!state || !busy) return null;
    const p = state;
    const isUploading = p.phase === "uploading";
    const isProcessing = p.phase === "processing";
    const isDone = p.phase === "done";
    const isError = p.phase === "error";
    const phaseLabel = isUploading
      ? (isAr ? "جارٍ الرفع..." : "Uploading...")
      : isProcessing
      ? (isAr ? "جارٍ المعالجة..." : "Processing...")
      : isDone
      ? (isAr ? "اكتمل" : "Done")
      : (isAr ? "خطأ" : "Error");

    return (
      <div className="space-y-2 p-3 rounded-md bg-muted/40 ring-1 ring-cyan-accent/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium">
            {isDone ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-accent" />}
            <span>{phaseLabel}</span>
          </div>
          <span className="text-xs font-mono text-cyan-accent">{p.progress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-300",
              isDone ? "bg-emerald-500" : isError ? "bg-red-500" : "bg-gradient-to-r from-cyan-500 to-cyan-accent"
            )}
            style={{ width: `${p.progress}%` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-1 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <span>{isAr ? "تم:" : "Done:"}</span>
            <span className="font-mono">{fmtBytes(p.bytesReceived)}</span>
            <span className="text-muted-foreground/60">/ {fmtBytes(p.bytesTotal)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="h-3 w-3 text-cyan-accent" />
            <span className="font-mono">{p.speedMBs?.toFixed(2) || "—"} MB/s</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-cyan-accent" />
            <span>{isAr ? "المنقضي:" : "Elapsed:"}</span>
            <span className="font-mono">{fmtTime(p.elapsedSeconds)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-amber-500" />
            <span>{isAr ? "المتبقي:" : "ETA:"}</span>
            <span className="font-mono">{fmtTime(p.etaSeconds)}</span>
          </div>
        </div>
      </div>
    );
  };

  // === Cancel button (aborts XHR) ===
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const splitXhrRef = useRef<XMLHttpRequest | null>(null);
  const handleCancelEnhance = useCallback(() => {
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    setBusy(null);
    setUploadProgress(null);
  }, []);

  /**
   * Split the video — uses raw byte streaming upload + ffmpeg for the split.
   * Mode: "duration" (split by time) | "count" (split into N segments)
   */
  const handleSplit = useCallback(() => {
    if (!splitFile) return;
    setBusy("split");
    setSplitResult(null);
    const startTime = Date.now();

    const params = new URLSearchParams({
      filename: splitFile.name,
      size: String(splitFile.size),
      mode: splitMode,
      segmentDuration: String(splitDuration),
      segmentCount: String(splitCount),
    });
    const url = `/api/video/split?${params.toString()}`;

    const xhr = new XMLHttpRequest();
    splitXhrRef.current = xhr;
    xhr.open("POST", url, true);
    xhr.responseType = "json";

    // === Upload progress ===
    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMBs = elapsedSec > 0 ? (e.loaded / 1024 / 1024) / elapsedSec : 0;
      const etaSec = speedMBs > 0 ? (e.total - e.loaded) / 1024 / 1024 / speedMBs : 0;
      setSplitProgress({
        phase: "uploading",
        progress: Math.round((e.loaded / e.total) * 40), // upload phase = 0-40%
        bytesReceived: e.loaded,
        bytesTotal: e.total,
        elapsedSeconds: elapsedSec,
        etaSeconds: etaSec,
        speedMBs: parseFloat(speedMBs.toFixed(2)),
      });
    });

    xhr.upload.addEventListener("error", () => {
      setSplitProgress({ phase: "error", progress: 0 });
      toast({ title: isAr ? "فشل الرفع" : "Upload failed", variant: "destructive" });
      setBusy(null);
    });

    // === After upload completes, poll for split progress (40-100%) ===
    xhr.addEventListener("load", () => {
      let d: any;
      try { d = xhr.response; } catch { d = null; }
      if (!d || !d.taskId) {
        setSplitProgress({ phase: "error", progress: 0 });
        toast({ title: "Error", description: d?.message || "No taskId", variant: "destructive" });
        setBusy(null);
        return;
      }

      const taskId = d.taskId;
      const pollStart = Date.now();
      const poll = async () => {
        for (let i = 0; i < 2400; i++) {  // up to 40 minutes
          await new Promise(r => setTimeout(r, 1000));
          const elapsedSec = (Date.now() - pollStart) / 1000;
          try {
            const pr = await fetch(`/api/task/status?id=${taskId}`);
            const pd = await pr.json();
            if (pd.status === "done" && pd.result) {
              setSplitResult(pd.result);
              setSplitProgress({ phase: "done", progress: 100, elapsedSeconds: Math.round((Date.now() - startTime) / 1000) });
              toast({ title: isAr ? `✅ تم التقسيم إلى ${pd.result.count} مقطع` : `✅ Split into ${pd.result.count} segments` });
              setBusy(null);
              return;
            }
            if (pd.status === "error") {
              setSplitProgress({ phase: "error", progress: pd.progress || 0 });
              toast({ title: "Error", description: pd.error, variant: "destructive" });
              setBusy(null);
              return;
            }
            const currentProgress = pd.progress || 40;
            const splitElapsed = currentProgress > 40 ? (elapsedSec / (currentProgress - 40)) * (100 - currentProgress) : 0;
            setSplitProgress({
              phase: pd.phase === "uploading" ? "uploading" : "processing",
              progress: currentProgress,
              bytesReceived: pd.bytesReceived,
              bytesTotal: pd.bytesTotal,
              elapsedSeconds: Math.round(elapsedSec),
              etaSeconds: Math.round(Math.max(0, splitElapsed)),
              speedMBs: pd.speedMBs,
            });
          } catch {}
        }
        setSplitProgress({ phase: "error", progress: 0 });
        toast({ title: isAr ? "انتهى الوقت" : "Timed out", variant: "destructive" });
        setBusy(null);
      };
      void poll();
    });

    xhr.addEventListener("error", () => {
      setSplitProgress({ phase: "error", progress: 0 });
      toast({ title: "Network error", variant: "destructive" });
      setBusy(null);
    });

    xhr.send(splitFile);
  }, [splitFile, splitMode, splitDuration, splitCount, isAr, toast]);

  const handleCancelSplit = useCallback(() => {
    if (splitXhrRef.current) {
      splitXhrRef.current.abort();
      splitXhrRef.current = null;
    }
    setBusy(null);
    setSplitProgress(null);
  }, []);

  // === Merge state ===
  const [mergeFiles, setMergeFiles] = useState<{ file: File; sessionId: string; index: number; status: "pending" | "uploading" | "done" | "error" }[]>([]);
  const mergeFilesRef = useRef(mergeFiles);
  mergeFilesRef.current = mergeFiles;
  const [mergeTransition, setMergeTransition] = useState<string>("none");
  const [mergeResult, setMergeResult] = useState<any>(null);
  const [mergeProgress, setMergeProgress] = useState<UploadProgressState | null>(null);
  const [mergeFileProgress, setMergeFileProgress] = useState<Record<number, UploadProgressState | null>>({});
  const mergeSessionId = useRef(`merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const mergeXhrRef = useRef<Record<number, XMLHttpRequest | null>>({});

  // Upload a single merge file (XHR for progress). Called as soon as a file is added.
  const doUploadMergeFile = useCallback((idx: number, file: File, sessionId: string) => {
    const url = `/api/video/merge/upload?sessionId=${sessionId}&index=${idx + 1}&filename=${encodeURIComponent(file.name)}&size=${file.size}`;
    const xhr = new XMLHttpRequest();
    mergeXhrRef.current[idx] = xhr;
    xhr.open("POST", url, true);
    xhr.responseType = "json";
    const startTime = Date.now();

    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMBs = elapsedSec > 0 ? (e.loaded / 1024 / 1024) / elapsedSec : 0;
      const etaSec = speedMBs > 0 ? (e.total - e.loaded) / 1024 / 1024 / speedMBs : 0;
      setMergeFileProgress(prev => ({
        ...prev,
        [idx]: {
          phase: "uploading",
          progress: Math.round((e.loaded / e.total) * 100),
          bytesReceived: e.loaded,
          bytesTotal: e.total,
          elapsedSeconds: Math.round(elapsedSec),
          etaSeconds: Math.round(etaSec),
          speedMBs: parseFloat(speedMBs.toFixed(2)),
        },
      }));
    });

    xhr.addEventListener("load", () => {
      setMergeFiles(prev => prev.map((m, i) => i === idx ? { ...m, status: "done" } : m));
      setMergeFileProgress(prev => ({
        ...prev,
        [idx]: { phase: "done", progress: 100, bytesReceived: file.size, bytesTotal: file.size },
      }));
    });

    xhr.upload.addEventListener("error", () => {
      setMergeFiles(prev => prev.map((m, i) => i === idx ? { ...m, status: "error" } : m));
      setMergeFileProgress(prev => ({ ...prev, [idx]: { phase: "error", progress: 0 } }));
    });

    xhr.send(file);
  }, []);

  // When user picks a new file for merge, add to list AND auto-upload it
  const addMergeFile = useCallback((file: File) => {
    const newIndex = mergeFilesRef.current.length;
    const sessionId = mergeSessionId.current;
    setMergeFiles(prev => [...prev, {
      file,
      sessionId,
      index: prev.length + 1,
      status: "uploading",
    }]);
    // Auto-upload in next tick (after state update is committed)
    setTimeout(() => doUploadMergeFile(newIndex, file, sessionId), 10);
  }, [doUploadMergeFile]);

  // Cancel a single upload
  const cancelMergeUpload = useCallback((idx: number) => {
    if (mergeXhrRef.current[idx]) {
      mergeXhrRef.current[idx]!.abort();
      mergeXhrRef.current[idx] = null;
    }
    setMergeFiles(prev => prev.filter((_, i) => i !== idx).map((m, i) => ({ ...m, index: i + 1 })));
    setMergeFileProgress(prev => {
      const cp = { ...prev };
      delete cp[idx];
      return cp;
    });
  }, []);

  // Finalize merge — call /api/video/merge/finalize
  const handleMerge = useCallback(async () => {
    if (mergeFiles.length < 2) {
      toast({ title: isAr ? "أضف فيديوهين على الأقل" : "Add at least 2 videos", variant: "destructive" });
      return;
    }
    // Make sure all files are uploaded
    const notUploaded = mergeFiles.filter(m => m.status !== "done");
    if (notUploaded.length > 0) {
      toast({ title: isAr ? "بعض الملفات لم تُرفع بعد" : "Some files not uploaded yet", variant: "destructive" });
      return;
    }

    setBusy("merge");
    setMergeResult(null);
    const startTime = Date.now();
    setMergeProgress({ phase: "processing", progress: 0, elapsedSeconds: 0, etaSeconds: 0 });

    try {
      const r = await fetch("/api/video/merge/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: mergeSessionId.current,
          transition: mergeTransition,
          outputFormat: ".mp4",
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.taskId) {
        setMergeProgress({ phase: "error", progress: 0 });
        toast({ title: "Error", description: d?.error || "Failed", variant: "destructive" });
        setBusy(null);
        return;
      }
      // Poll
      for (let i = 0; i < 2400; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const elapsedSec = (Date.now() - startTime) / 1000;
        const pr = await fetch(`/api/task/status?id=${d.taskId}`);
        const pd = await pr.json();
        if (pd.status === "done" && pd.result) {
          setMergeResult(pd.result);
          setMergeProgress({ phase: "done", progress: 100, elapsedSeconds: Math.round(elapsedSec) });
          toast({ title: isAr ? "✅ تم الدمج" : "✅ Merged" });
          setBusy(null);
          return;
        }
        if (pd.status === "error") {
          setMergeProgress({ phase: "error", progress: pd.progress || 0 });
          toast({ title: "Error", description: pd.error, variant: "destructive" });
          setBusy(null);
          return;
        }
        const currentProgress = pd.progress || 0;
        const etaSec = currentProgress > 0 ? (elapsedSec / currentProgress) * (100 - currentProgress) : 0;
        setMergeProgress({
          phase: "processing",
          progress: currentProgress,
          elapsedSeconds: Math.round(elapsedSec),
          etaSeconds: Math.round(Math.max(0, etaSec)),
        });
      }
      setMergeProgress({ phase: "error", progress: 0 });
      toast({ title: isAr ? "انتهى الوقت" : "Timed out", variant: "destructive" });
      setBusy(null);
    } catch (e) {
      setMergeProgress({ phase: "error", progress: 0 });
      toast({ title: "Error", description: e instanceof Error ? e.message : "", variant: "destructive" });
      setBusy(null);
    }
  }, [mergeFiles, mergeTransition, isAr, toast]);

  // === Trim state ===
  const [trimFile, setTrimFile] = useState<File | null>(null);
  const [trimMode, setTrimMode] = useState<"remove" | "keep">("remove");
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(5);
  const [trimResult, setTrimResult] = useState<any>(null);
  const [trimProgress, setTrimProgress] = useState<UploadProgressState | null>(null);
  const trimInputRef = useRef<HTMLInputElement>(null);
  const trimXhrRef = useRef<XMLHttpRequest | null>(null);

  // === Preview state (for non-browser-playable formats like .3gp, .avi, .mkv) ===
  // Maps File object → { previewUrl, loading, error }
  // (Used by Enhance and Trim cards when their uploaded file isn't browser-playable)
  const [previewCache, setPreviewCache] = useState<Record<string, { previewUrl?: string; loading?: boolean; error?: string }>>({});
  const previewXhrRef = useRef<Record<string, XMLHttpRequest | null>>({});

  // Generate a preview for any file that's not browser-playable
  // Returns the key for tracking, and triggers the preview generation
  const generatePreview = useCallback((file: File, keyPrefix: string) => {
    // If file is browser-playable, no preview needed — just use object URL
    if (PLAYABLE.test(file.name)) return;

    const cacheKey = `${keyPrefix}-${file.name}-${file.size}-${file.lastModified}`;
    // Already cached or in-progress
    if (previewCache[cacheKey]?.previewUrl || previewCache[cacheKey]?.loading) return;

    setPreviewCache(prev => ({ ...prev, [cacheKey]: { loading: true } }));

    const url = `/api/video/preview?filename=${encodeURIComponent(file.name)}&size=${file.size}&maxDuration=10`;
    const xhr = new XMLHttpRequest();
    previewXhrRef.current[cacheKey] = xhr;
    xhr.open("POST", url, true);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 50); // upload phase = 0-50%
      setPreviewCache(prev => ({
        ...prev,
        [cacheKey]: { loading: true, progress: pct, phase: "uploading" },
      }));
    });

    xhr.addEventListener("load", () => {
      let d: any;
      try { d = xhr.response; } catch { d = null; }
      if (!d || !d.taskId) {
        setPreviewCache(prev => ({ ...prev, [cacheKey]: { error: "No taskId" } }));
        return;
      }
      // Poll task status for preview generation
      const taskId = d.taskId;
      const poll = async () => {
        for (let i = 0; i < 600; i++) {
          await new Promise(r => setTimeout(r, 1500));
          try {
            const pr = await fetch(`/api/task/status?id=${taskId}`);
            const pd = await pr.json();
            if (pd.status === "done" && pd.result?.previewUrl) {
              setPreviewCache(prev => ({
                ...prev,
                [cacheKey]: { previewUrl: pd.result.previewUrl, method: pd.result.method },
              }));
              return;
            }
            if (pd.status === "error") {
              setPreviewCache(prev => ({ ...prev, [cacheKey]: { error: pd.error || "Preview failed" } }));
              return;
            }
            // Update progress
            setPreviewCache(prev => ({
              ...prev,
              [cacheKey]: { loading: true, progress: pd.progress || 50, phase: pd.phase || "processing" },
            }));
          } catch {}
        }
        setPreviewCache(prev => ({ ...prev, [cacheKey]: { error: "Timed out" } }));
      };
      void poll();
    });

    xhr.upload.addEventListener("error", () => {
      setPreviewCache(prev => ({ ...prev, [cacheKey]: { error: "Upload failed" } }));
    });

    xhr.addEventListener("error", () => {
      setPreviewCache(prev => ({ ...prev, [cacheKey]: { error: "Network error" } }));
    });

    xhr.send(file);
  }, [previewCache]);

  // Helper: get the preview URL for a file (or use object URL if playable)
  const getVideoSrc = useCallback((file: File | null, keyPrefix: string): { src: string; isPlayable: boolean; loading?: boolean; error?: string; progress?: number; phase?: string } => {
    if (!file) return { src: "", isPlayable: false };
    if (PLAYABLE.test(file.name)) {
      return { src: URL.createObjectURL(file), isPlayable: true };
    }
    const cacheKey = `${keyPrefix}-${file.name}-${file.size}-${file.lastModified}`;
    const cached = previewCache[cacheKey];
    if (cached?.previewUrl) {
      return { src: cached.previewUrl, isPlayable: true };
    }
    return { src: "", isPlayable: false, loading: cached?.loading, error: cached?.error, progress: cached?.progress, phase: cached?.phase };
  }, [previewCache]);

  const handleTrim = useCallback(() => {
    if (!trimFile) return;
    setBusy("trim");
    setTrimResult(null);
    const startTime = Date.now();

    const url = `/api/video/trim?filename=${encodeURIComponent(trimFile.name)}&size=${trimFile.size}&mode=${trimMode}&startTime=${trimStart}&endTime=${trimEnd}`;
    const xhr = new XMLHttpRequest();
    trimXhrRef.current = xhr;
    xhr.open("POST", url, true);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMBs = elapsedSec > 0 ? (e.loaded / 1024 / 1024) / elapsedSec : 0;
      const etaSec = speedMBs > 0 ? (e.total - e.loaded) / 1024 / 1024 / speedMBs : 0;
      setTrimProgress({
        phase: "uploading",
        progress: Math.round((e.loaded / e.total) * 40),
        bytesReceived: e.loaded,
        bytesTotal: e.total,
        elapsedSeconds: elapsedSec,
        etaSeconds: etaSec,
        speedMBs: parseFloat(speedMBs.toFixed(2)),
      });
    });

    xhr.upload.addEventListener("error", () => {
      setTrimProgress({ phase: "error", progress: 0 });
      toast({ title: isAr ? "فشل الرفع" : "Upload failed", variant: "destructive" });
      setBusy(null);
    });

    xhr.addEventListener("load", () => {
      let d: any;
      try { d = xhr.response; } catch { d = null; }
      if (!d || !d.taskId) {
        setTrimProgress({ phase: "error", progress: 0 });
        toast({ title: "Error", description: d?.message || "No taskId", variant: "destructive" });
        setBusy(null);
        return;
      }
      // Poll
      const pollStart = Date.now();
      const poll = async () => {
        for (let i = 0; i < 2400; i++) {
          await new Promise(r => setTimeout(r, 1000));
          const elapsedSec = (Date.now() - pollStart) / 1000;
          try {
            const pr = await fetch(`/api/task/status?id=${d.taskId}`);
            const pd = await pr.json();
            if (pd.status === "done" && pd.result) {
              setTrimResult(pd.result);
              setTrimProgress({ phase: "done", progress: 100, elapsedSeconds: Math.round((Date.now() - startTime) / 1000) });
              toast({ title: isAr ? "✅ تم القص" : "✅ Trimmed" });
              setBusy(null);
              return;
            }
            if (pd.status === "error") {
              setTrimProgress({ phase: "error", progress: pd.progress || 0 });
              toast({ title: "Error", description: pd.error, variant: "destructive" });
              setBusy(null);
              return;
            }
            const currentProgress = pd.progress || 40;
            const trimElapsed = currentProgress > 40 ? (elapsedSec / (currentProgress - 40)) * (100 - currentProgress) : 0;
            setTrimProgress({
              phase: pd.phase === "uploading" ? "uploading" : "processing",
              progress: currentProgress,
              bytesReceived: pd.bytesReceived,
              bytesTotal: pd.bytesTotal,
              elapsedSeconds: Math.round(elapsedSec),
              etaSeconds: Math.round(Math.max(0, trimElapsed)),
              speedMBs: pd.speedMBs,
            });
          } catch {}
        }
        setTrimProgress({ phase: "error", progress: 0 });
        setBusy(null);
      };
      void poll();
    });

    xhr.addEventListener("error", () => {
      setTrimProgress({ phase: "error", progress: 0 });
      toast({ title: "Network error", variant: "destructive" });
      setBusy(null);
    });

    xhr.send(trimFile);
  }, [trimFile, trimMode, trimStart, trimEnd, isAr, toast]);

  const handleCancelTrim = useCallback(() => {
    if (trimXhrRef.current) {
      trimXhrRef.current.abort();
      trimXhrRef.current = null;
    }
    setBusy(null);
    setTrimProgress(null);
  }, []);

  // === Convert (video format conversion + enhancement) ===
  const [convertFile, setConvertFile] = useState<File | null>(null);
  const [convertTargetFormat, setConvertTargetFormat] = useState<string>("mp4");
  const [convertQuality, setConvertQuality] = useState<string>("medium");
  const [convertUpscale, setConvertUpscale] = useState<string>("1");
  const [convertDenoise, setConvertDenoise] = useState(false);
  const [convertSharpen, setConvertSharpen] = useState(false);
  const [convertColorEnhance, setConvertColorEnhance] = useState(false);
  const [convertBoost, setConvertBoost] = useState(false);
  const [convertResult, setConvertResult] = useState<any>(null);
  const [convertProgress, setConvertProgress] = useState<UploadProgressState | null>(null);
  const convertInputRef = useRef<HTMLInputElement>(null);
  const convertXhrRef = useRef<XMLHttpRequest | null>(null);

  const handleConvert = useCallback(() => {
    if (!convertFile) return;
    setBusy("convert");
    setConvertResult(null);
    const startTime = Date.now();

    // Build URL with all options
    const params = new URLSearchParams({
      filename: convertFile.name,
      size: String(convertFile.size),
      targetFormat: convertTargetFormat,
      quality: convertQuality,
      upscale: convertUpscale,
      denoise: convertDenoise ? "1" : "0",
      sharpen: convertSharpen ? "1" : "0",
      colorEnhance: convertColorEnhance ? "1" : "0",
      boost: convertBoost ? "1" : "0",
    });
    const url = `/api/video/convert?${params.toString()}`;

    const xhr = new XMLHttpRequest();
    convertXhrRef.current = xhr;
    xhr.open("POST", url, true);
    xhr.responseType = "json";

    // Upload progress
    xhr.upload.addEventListener("progress", (e: ProgressEvent) => {
      if (!e.lengthComputable) return;
      const elapsedSec = (Date.now() - startTime) / 1000;
      const speedMBs = elapsedSec > 0 ? (e.loaded / 1024 / 1024) / elapsedSec : 0;
      const etaSec = speedMBs > 0 ? (e.total - e.loaded) / 1024 / 1024 / speedMBs : 0;
      setConvertProgress({
        phase: "uploading",
        progress: Math.round((e.loaded / e.total) * 40),
        bytesReceived: e.loaded,
        bytesTotal: e.total,
        elapsedSeconds: elapsedSec,
        etaSeconds: etaSec,
        speedMBs: parseFloat(speedMBs.toFixed(2)),
      });
    });

    xhr.upload.addEventListener("error", () => {
      setConvertProgress({ phase: "error", progress: 0 });
      toast({ title: isAr ? "فشل الرفع" : "Upload failed", variant: "destructive" });
      setBusy(null);
    });

    // After upload completes, poll task status for conversion
    xhr.addEventListener("load", () => {
      let d: any;
      try { d = xhr.response; } catch { d = null; }
      if (!d || !d.taskId) {
        setConvertProgress({ phase: "error", progress: 0 });
        toast({ title: "Error", description: d?.message || "No taskId", variant: "destructive" });
        setBusy(null);
        return;
      }
      const taskId = d.taskId;
      const pollStart = Date.now();
      const poll = async () => {
        for (let i = 0; i < 3600; i++) {  // up to 60 min
          await new Promise(r => setTimeout(r, 1000));
          const elapsedSec = (Date.now() - pollStart) / 1000;
          try {
            const pr = await fetch(`/api/task/status?id=${taskId}`);
            const pd = await pr.json();
            if (pd.status === "done" && pd.result) {
              setConvertResult(pd.result);
              setConvertProgress({ phase: "done", progress: 100, elapsedSeconds: Math.round((Date.now() - startTime) / 1000) });
              toast({ title: isAr ? `✅ تم التحويل إلى ${pd.result.format}` : `✅ Converted to ${pd.result.format}` });
              setBusy(null);
              return;
            }
            if (pd.status === "error") {
              setConvertProgress({ phase: "error", progress: pd.progress || 0 });
              toast({ title: "Error", description: pd.error, variant: "destructive" });
              setBusy(null);
              return;
            }
            const currentProgress = pd.progress || 40;
            const convElapsed = currentProgress > 40 ? (elapsedSec / (currentProgress - 40)) * (100 - currentProgress) : 0;
            setConvertProgress({
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
        setConvertProgress({ phase: "error", progress: 0 });
        setBusy(null);
      };
      void poll();
    });

    xhr.addEventListener("error", () => {
      setConvertProgress({ phase: "error", progress: 0 });
      toast({ title: "Network error", variant: "destructive" });
      setBusy(null);
    });

    xhr.send(convertFile);
  }, [convertFile, convertTargetFormat, convertQuality, convertUpscale, convertDenoise, convertSharpen, convertColorEnhance, convertBoost, isAr, toast]);

  const handleCancelConvert = useCallback(() => {
    if (convertXhrRef.current) {
      convertXhrRef.current.abort();
      convertXhrRef.current = null;
    }
    setBusy(null);
    setConvertProgress(null);
  }, []);

  // Simplified session callbacks (generate tab removed)
  const onReset = useCallback(() => {}, []);
  const onRestore = useCallback((_st: any) => {}, []);
  const getSnapshot = useCallback(() => ({}), []);
  // === Service switching logic ===
  // Active service (only one service visible at a time)
  const [activeService, setActiveService] = useState<"enhance" | "split" | "trim" | "merge" | "convert" | "faceSwap" | "garmentSwap">("enhance");
  const [pendingService, setPendingService] = useState<"enhance" | "split" | "trim" | "merge" | "convert" | "faceSwap" | "garmentSwap" | null>(null);
  const [showSwitchDialog, setShowSwitchDialog] = useState(false);
  // The swap services (face/garment) manage their own state in a child
  // component — they report "has unsaved state" and a reset() via refs.
  const swapStateRef = useRef<{ faceSwap: boolean; garmentSwap: boolean }>({ faceSwap: false, garmentSwap: false });
  const swapResetRef = useRef<Record<string, () => void>>({});

  // Check if a service has unsaved state (uploaded files or results)
  const serviceHasState = useCallback((svc: typeof activeService): boolean => {
    switch (svc) {
      case "enhance":  return !!enhanceFile || !!enhanceResult || !!uploadProgress;
      case "split":    return !!splitFile || !!splitResult || !!splitProgress;
      case "trim":     return !!trimFile || !!trimResult || !!trimProgress;
      case "merge":    return mergeFiles.length > 0 || !!mergeResult || !!mergeProgress;
      case "convert":  return !!convertFile || !!convertResult || !!convertProgress;
      case "faceSwap":   return !!swapStateRef.current.faceSwap;
      case "garmentSwap": return !!swapStateRef.current.garmentSwap;
    }
    return false;
  }, [enhanceFile, enhanceResult, uploadProgress, splitFile, splitResult, splitProgress, trimFile, trimResult, trimProgress, mergeFiles.length, mergeResult, mergeProgress, convertFile, convertResult, convertProgress]);

  // Reset state for a service (frontend state only — doesn't touch disk)
  const resetServiceState = useCallback((svc: typeof activeService) => {
    switch (svc) {
      case "enhance":
        setEnhanceFile(null); setEnhanceResult(null); setUploadProgress(null);
        break;
      case "split":
        setSplitFile(null); setSplitResult(null); setSplitProgress(null);
        break;
      case "trim":
        setTrimFile(null); setTrimResult(null); setTrimProgress(null);
        break;
      case "merge":
        setMergeFiles([]); setMergeResult(null); setMergeProgress(null); setMergeFileProgress({});
        mergeSessionId.current = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        break;
      case "convert":
        setConvertFile(null); setConvertResult(null); setConvertProgress(null);
        break;
      case "faceSwap":
        swapResetRef.current["faceSwap"]?.();
        break;
      case "garmentSwap":
        swapResetRef.current["garmentSwap"]?.();
        break;
    }
  }, []);

  // Call the clear API for a service (deletes files from disk).
  // The swap services manage their own state — no disk cleanup needed here.
  const clearServiceFiles = useCallback(async (svc: "enhance" | "split" | "trim" | "merge" | "convert" | "faceSwap" | "garmentSwap" | "all") => {
    if (svc === "faceSwap" || svc === "garmentSwap") return;
    try {
      const r = await fetch("/api/video/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: svc }),
      });
      const d = await r.json();
      if (d.ok) {
        toast({
          title: isAr ? "🧹 تم التنظيف" : "🧹 Cleaned",
          description: isAr
            ? `حُذف ${d.deletedCount} عنصر، حرر ${(d.freedMB || 0).toFixed(1)}MB`
            : `${d.deletedCount} items deleted, ${(d.freedMB || 0).toFixed(1)}MB freed`,
        });
      }
    } catch (e: any) {
      console.error("[clearServiceFiles]", e);
    }
  }, [isAr, toast]);

  // Handle clicking a different service tab
  const handleSwitchService = useCallback((newService: typeof activeService) => {
    if (newService === activeService) return;
    // If the current service has state (files/results), show warning dialog
    if (serviceHasState(activeService)) {
      setPendingService(newService);
      setShowSwitchDialog(true);
    } else {
      // No state — just switch directly
      setActiveService(newService);
    }
  }, [activeService, serviceHasState]);

  // Confirm switch (after warning dialog)
  const confirmSwitch = useCallback(async (skipSave: boolean) => {
    setShowSwitchDialog(false);
    if (!pendingService) return;
    // If not skipSave: download the result first (if any)
    if (!skipSave) {
      const cur = activeService;
      let url: string | null = null;
      if (cur === "enhance" && enhanceResult?.url) url = enhanceResult.url;
      else if (cur === "split" && splitResult?.segments?.length) {
        // For split, download all segments
        for (const seg of splitResult.segments) {
          if (seg.url) {
            const a = document.createElement("a");
            a.href = seg.url;
            a.download = `segment-${seg.index + 1}`;
            a.click();
          }
        }
      }
      else if (cur === "trim" && trimResult?.url) url = trimResult.url;
      else if (cur === "merge" && mergeResult?.url) url = mergeResult.url;
      if (url) {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${cur}-result`;
        a.click();
      }
    }
    // Clear the current service's state + files
    await clearServiceFiles(activeService);
    resetServiceState(activeService);
    // Switch to the new service
    setActiveService(pendingService);
    setPendingService(null);
  }, [pendingService, activeService, enhanceResult, splitResult, trimResult, mergeResult, clearServiceFiles, resetServiceState]);

  // Cancel switch
  const cancelSwitch = useCallback(() => {
    setShowSwitchDialog(false);
    setPendingService(null);
  }, []);

  // Save & clear: download the result AND clear state/files
  const saveAndClear = useCallback(async (svc: typeof activeService, url?: string) => {
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `${svc}-result-${Date.now()}`;
      a.click();
    }
    await clearServiceFiles(svc);
    resetServiceState(svc);
    toast({ title: isAr ? "✅ تم الحفظ والتنظيف" : "✅ Saved & cleared" });
  }, [clearServiceFiles, resetServiceState, isAr, toast]);

  return (
    <div className="flex flex-col gap-3">
      <SessionToolbar section="video-editor" onResetState={onReset} onRestoreState={onRestore} getSnapshot={getSnapshot} />

      {/* === Service tabs (only one active at a time) === */}
      <div className="grid grid-cols-7 gap-1 p-1.5 rounded-md bg-muted/30 ring-1 ring-cyan-accent/20">
        {([
          { key: "enhance", ar: "تحسين", en: "Enhance", icon: <Sparkles className="h-4 w-4" /> },
          { key: "split", ar: "تقسيم", en: "Split", icon: <Scissors className="h-4 w-4" /> },
          { key: "trim", ar: "قص", en: "Trim", icon: <Crop className="h-4 w-4" /> },
          { key: "merge", ar: "دمج", en: "Merge", icon: <Merge className="h-4 w-4" /> },
          { key: "convert", ar: "تحويل", en: "Convert", icon: <ArrowRight className="h-4 w-4" /> },
          { key: "faceSwap", ar: "وجوه", en: "Face Swap", icon: <Users className="h-4 w-4" /> },
          { key: "garmentSwap", ar: "ملابس", en: "Garments", icon: <Shirt className="h-4 w-4" /> },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => handleSwitchService(t.key)}
            className={cn(
              "flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[10px] font-medium transition-all",
              activeService === t.key
                ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent"
                : "bg-muted/20 hover:bg-muted/40 text-muted-foreground"
            )}
          >
            {t.icon}
            <span>{isAr ? t.ar : t.en}</span>
          </button>
        ))}
      </div>

      {/* === Warning dialog when switching services === */}
      <Dialog open={showSwitchDialog} onOpenChange={setShowSwitchDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {isAr ? "تحذير: سيتم حذف العملية السابقة" : "Warning: previous operation will be deleted"}
            </DialogTitle>
            <DialogDescription>
              {isAr
                ? "لمنع تحميل عدة عمليات في نفس الوقت، سيتم حذف الملفات المرفوعة والنتائج في الخدمة الحالية عند الانتقال لخدمة أخرى. احفظ النتيجة أولاً إن لزم."
                : "To prevent loading multiple operations at once, uploaded files and results in the current service will be deleted when switching to another service. Save the result first if needed."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={() => confirmSwitch(false)}
              className="bg-cyan-accent text-black hover:bg-cyan-accent/90 font-semibold"
            >
              <Download className="h-4 w-4" />
              {isAr ? "حفظ النتيجة ثم المتابعة" : "Save result then proceed"}
            </Button>
            <Button
              variant="outline"
              onClick={() => confirmSwitch(true)}
              className="text-amber-500"
            >
              {isAr ? "متابعة بدون حفظ" : "Proceed without saving"}
            </Button>
            <Button variant="ghost" onClick={cancelSwitch}>
              <X className="h-4 w-4" />
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* === NEW: video face swap / garment swap (numbered boxes) === */}
      {(activeService === "faceSwap" || activeService === "garmentSwap") && (
        <VideoSwapService
          mode={activeService === "faceSwap" ? "face" : "garment"}
          onStateChange={(has) => { swapStateRef.current[activeService === "faceSwap" ? "faceSwap" : "garmentSwap"] = has; }}
          registerReset={(fn) => { swapResetRef.current[activeService === "faceSwap" ? "faceSwap" : "garmentSwap"] = fn; }}
        />
      )}

      {/* === Only render the active service's card === */}
      {activeService === "enhance" && (
        <Card className="studio-panel border-cyan-accent/30">
          <CardHeader className="py-2"><CardTitle className="text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-accent" />{isAr ? "وكيل تحسين الفيديو" : "Video Enhance"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground flex items-center justify-between">
                <span>{isAr ? "ارفع الفيديو" : "Upload Video"}</span>
                <span className="text-[9px] text-emerald-500 font-normal">{isAr ? "بلا حدود" : "No size limit"}</span>
              </Label>
              <div className="relative">
                {!enhanceFile ? (
                  <div onClick={() => enhanceInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[120px] rounded-md bg-black/30 border border-dashed border-cyan-accent/30 hover:bg-black/40 transition-colors">
                    <UploadCloud className="h-8 w-8 text-cyan-accent" />
                    <p className="text-xs mt-2">{isAr ? "ارفع أي فيديو" : "Upload any video"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {isAr ? "MP4، 3GP، AVI، MOV، MKV، WebM..." : "MP4, 3GP, AVI, MOV, MKV, WebM..."}
                    </p>
                    <p className="text-[9px] text-emerald-500 mt-1">{isAr ? "حجم غير محدود ✓" : "Unlimited size ✓"}</p>
                    <input
                      ref={enhanceInputRef}
                      type="file"
                      accept={ACCEPT_ATTR}
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setEnhanceFile(f);
                          setEnhanceResult(null);
                          setUploadProgress(null);
                          // Auto-generate a browser-playable preview if the format isn't browser-playable (.3gp, .avi, .mkv, etc.)
                          generatePreview(f, "enhance");
                        }
                        e.target.value = "";
                      }}
                    />
                  </div>
                ) : (
                  <div className="relative rounded overflow-hidden bg-black/50">
                    {/* Preview: works for ANY format. For non-browser-playable formats,
                        we auto-generate an MP4 preview via /api/video/preview. */}
                    {(() => {
                      const v = getVideoSrc(enhanceFile, "enhance");
                      if (v.isPlayable && v.src) {
                        return <video src={v.src} controls className="w-full max-h-[200px]" />;
                      }
                      if (v.loading) {
                        return (
                          <div className="p-4 text-center">
                            <Loader2 className="h-6 w-6 animate-spin text-cyan-accent mx-auto mb-2" />
                            <p className="text-[11px] font-medium">{enhanceFile.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {(enhanceFile.size / 1024 / 1024).toFixed(1)}MB · {enhanceFile.name.split(".").pop()?.toUpperCase()}
                            </p>
                            <p className="text-[10px] text-cyan-accent mt-1">
                              {isAr
                                ? v.phase === "uploading"
                                  ? `جارٍ رفع الفيديو للمعاينة... ${v.progress || 0}%`
                                  : "جارٍ توليد معاينة MP4..."
                                : v.phase === "uploading"
                                ? `Uploading for preview... ${v.progress || 0}%`
                                : "Generating MP4 preview..."}
                            </p>
                            {(v.progress !== undefined && v.progress > 0) && (
                              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden max-w-[200px] mx-auto">
                                <div className="h-full bg-cyan-accent transition-all" style={{ width: `${v.progress}%` }} />
                              </div>
                            )}
                          </div>
                        );
                      }
                      if (v.error) {
                        return (
                          <div className="p-4 text-center">
                            <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto mb-2" />
                            <p className="text-[11px] font-medium">{enhanceFile.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{v.error}</p>
                          </div>
                        );
                      }
                      return (
                        <div className="p-4 text-center">
                          <UploadCloud className="h-8 w-8 text-cyan-accent mx-auto mb-2" />
                          <p className="text-xs font-medium">{enhanceFile.name}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {(enhanceFile.size / 1024 / 1024).toFixed(1)}MB · {enhanceFile.name.split(".").pop()?.toUpperCase()}
                          </p>
                        </div>
                      );
                    })()}
                    <button onClick={() => { setEnhanceFile(null); setEnhanceResult(null); setUploadProgress(null); }} className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center z-10">
                      <X className="h-3.5 w-3.5 text-white" />
                    </button>
                    <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/70 text-[10px] text-white/80">
                      {enhanceFile.name} · {fmtBytes(enhanceFile.size)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5"><Label className="text-[11px] text-muted-foreground">{isAr ? "جودة الإخراج" : "Output"}</Label><div className="grid grid-cols-6 gap-1">{(Object.keys(QL) as VQ[]).map(q => <button key={q} onClick={() => setEnhanceQuality(q)} className={cn("flex flex-col items-center py-1.5 rounded text-[9px]", enhanceQuality === q ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}><span>{QL[q][isAr ? "ar" : "en"]}</span><span className="text-[7px] opacity-60">{QL[q].tag}</span></button>)}</div></div>

            <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground"><div className="flex items-center gap-1.5 p-1.5 rounded bg-muted/30"><RefreshCw className="h-3 w-3 text-cyan-accent" />{isAr ? "ترميم" : "Restore"}</div><div className="flex items-center gap-1.5 p-1.5 rounded bg-muted/30"><Sun className="h-3 w-3 text-cyan-accent" />{isAr ? "صوت" : "Audio"}</div><div className="flex items-center gap-1.5 p-1.5 rounded bg-muted/30"><Sparkles className="h-3 w-3 text-cyan-accent" />{isAr ? "رفع" : "Upscale"}</div><div className="flex items-center gap-1.5 p-1.5 rounded bg-muted/30"><Settings className="h-3 w-3 text-cyan-accent" />{isAr ? "إطار" : "Frame"}</div></div>

            {/* === Progress bar (during upload + enhance) === */}
            {renderProgress(uploadProgress, "enhance")}

            <div className="flex gap-2">
              <Button onClick={() => {
                // Save xhr ref for cancel
                const xhr = new XMLHttpRequest();
                xhrRef.current = xhr;
                handleEnhance();
              }} disabled={!enhanceFile || !!busy} className="flex-1 h-10 text-sm bg-cyan-accent text-black hover:bg-cyan-accent/90">
                {busy === "enhance" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isAr ? "حسّن" : "Enhance"}
              </Button>
              {busy === "enhance" && (
                <Button variant="outline" onClick={handleCancelEnhance} className="h-10 px-3 text-red-400">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            {enhanceResult && (
              <div className="space-y-2">
                <div className="rounded overflow-hidden bg-black/50 ring-1 ring-cyan-accent/30">
                  {enhanceResult.url?.match(PLAYABLE) ? (
                    <video src={enhanceResult.url} controls className="w-full max-h-[200px]" />
                  ) : (
                    <img src={enhanceResult.posterUrl || enhanceResult.url} alt="enhanced" className="w-full max-h-[200px] object-contain" />
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => {
                    const a = document.createElement("a");
                    a.href = enhanceResult.url;
                    a.download = `enhanced-${Date.now()}`;
                    a.click();
                  }} className="h-8">
                    <Download className="h-3.5 w-3.5" />
                    <span className="text-xs ml-1">{isAr ? "تحميل" : "Download"}</span>
                  </Button>
                  {enhanceResult.posterUrl && (
                    <Button size="sm" variant="outline" onClick={() => {
                      const a = document.createElement("a");
                      a.href = enhanceResult.posterUrl;
                      a.download = `poster-${Date.now()}.png`;
                      a.click();
                    }} className="h-8">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="text-xs ml-1">{isAr ? "البوستر" : "Poster"}</span>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => { setEnhanceResult(null); setUploadProgress(null); }} className="h-8 text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeService === "split" && (
        <Card className="studio-panel border-cyan-accent/30">
          <CardHeader className="py-2"><CardTitle className="text-sm flex items-center gap-2"><Scissors className="h-4 w-4 text-cyan-accent" />{isAr ? "وكيل تقسيم الفيديو" : "Video Split"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* Upload + mode selection */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>{isAr ? "ارفع الفيديو لتقسيمه" : "Upload Video to Split"}</span>
                  <span className="text-[9px] text-emerald-500 font-normal">{isAr ? "بلا حدود" : "No size limit"}</span>
                </Label>
                <div className="relative">
                  {!splitFile ? (
                    <div onClick={() => splitInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[120px] rounded-md bg-black/30 border border-dashed border-cyan-accent/30 hover:bg-black/40 transition-colors">
                      <UploadCloud className="h-8 w-8 text-cyan-accent" />
                      <p className="text-xs mt-2">{isAr ? "ارفع أي فيديو" : "Upload any video"}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {isAr ? "MP4، 3GP، AVI، MOV، MKV، WebM..." : "MP4, 3GP, AVI, MOV, MKV, WebM..."}
                      </p>
                      <p className="text-[9px] text-emerald-500 mt-1">{isAr ? "حجم غير محدود ✓" : "Unlimited size ✓"}</p>
                      <input
                        ref={splitInputRef}
                        type="file"
                        accept={ACCEPT_ATTR}
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setSplitFile(f);
                            setSplitResult(null);
                            setSplitProgress(null);
                          }
                          e.target.value = "";
                        }}
                      />
                    </div>
                  ) : (
                    <div className="relative rounded overflow-hidden bg-black/50">
                      <div className="p-4 text-center">
                        <Film className="h-8 w-8 text-cyan-accent mx-auto mb-2" />
                        <p className="text-xs font-medium">{splitFile.name}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {fmtBytes(splitFile.size)} · {splitFile.name.split(".").pop()?.toUpperCase()}
                        </p>
                      </div>
                      <button onClick={() => { setSplitFile(null); setSplitResult(null); setSplitProgress(null); }} className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center z-10">
                        <X className="h-3.5 w-3.5 text-white" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mode selector */}
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "طريقة التقسيم" : "Split Mode"}</Label>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setSplitMode("duration")}
                    className={cn("flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-medium", splitMode === "duration" ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                  >
                    <Timer className="h-3.5 w-3.5" />
                    {isAr ? "حسب المدة" : "By Duration"}
                  </button>
                  <button
                    onClick={() => setSplitMode("count")}
                    className={cn("flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-medium", splitMode === "count" ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                  >
                    <Hash className="h-3.5 w-3.5" />
                    {isAr ? "حسب العدد" : "By Count"}
                  </button>
                </div>
              </div>

              {/* Duration dropdown (5s to 1h) */}
              {splitMode === "duration" ? (
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">{isAr ? "مدة كل مقطع" : "Segment Duration"}</Label>
                  <select
                    value={splitDuration}
                    onChange={e => setSplitDuration(parseInt(e.target.value, 10))}
                    className="w-full h-9 px-2 rounded-md bg-black/30 border border-cyan-accent/30 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-accent"
                  >
                    {SPLIT_DURATIONS.map(d => (
                      <option key={d} value={d} className="bg-background text-foreground">
                        {fmtDur(d)} {isAr ? "(لكل مقطع)" : "(per segment)"}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-muted-foreground">
                    {isAr ? "من 5 ثواني إلى 1 ساعة" : "From 5 seconds to 1 hour"}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">{isAr ? "عدد المقاطع" : "Number of Segments"}</Label>
                  <select
                    value={splitCount}
                    onChange={e => setSplitCount(parseInt(e.target.value, 10))}
                    className="w-full h-9 px-2 rounded-md bg-black/30 border border-cyan-accent/30 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-accent"
                  >
                    {SPLIT_COUNTS.map(c => (
                      <option key={c} value={c} className="bg-background text-foreground">
                        {c} {isAr ? "مقاطع" : "segments"}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-muted-foreground">
                    {isAr ? "من 2 إلى 100 مقطع" : "From 2 to 100 segments"}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={handleSplit} disabled={!splitFile || !!busy} className="flex-1 h-10 text-sm bg-cyan-accent text-black hover:bg-cyan-accent/90">
                  {busy === "split" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                  {isAr ? "قسّم الفيديو" : "Split Video"}
                </Button>
                {busy === "split" && (
                  <Button variant="outline" onClick={handleCancelSplit} className="h-10 px-3 text-red-400">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Progress + results */}
            <div className="space-y-3">
              {renderProgress(splitProgress, "split")}

              {splitResult && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium">
                      {isAr ? `النتيجة: ${splitResult.count} مقطع` : `Result: ${splitResult.count} segments`}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {isAr ? "المدة الكلية" : "Total"}: {fmtTime(splitResult.totalDuration || 0)}
                    </p>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto space-y-1.5 p-2 rounded-md bg-black/30 ring-1 ring-cyan-accent/20">
                    {(splitResult.segments || []).map((seg: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
                        <div className="shrink-0 h-7 w-7 rounded-full bg-cyan-accent/15 ring-1 ring-cyan-accent/40 flex items-center justify-center text-[10px] font-mono text-cyan-accent">
                          {String(seg.index + 1).padStart(2, "0")}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-mono break-all">{seg.url.split("/").pop()}</p>
                          <p className="text-[9px] text-muted-foreground">
                            {fmtTime(seg.startTime)} → {fmtTime(seg.endTime)} · {fmtTime(seg.duration)}
                          </p>
                        </div>
                        <a
                          href={seg.url}
                          download
                          className="shrink-0 h-7 w-7 rounded-md bg-cyan-accent/15 hover:bg-cyan-accent/30 ring-1 ring-cyan-accent/40 flex items-center justify-center"
                          title={`Download segment ${seg.index + 1}`}
                        >
                          <Download className="h-3 w-3 text-cyan-accent" />
                        </a>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { setSplitResult(null); setSplitProgress(null); }} className="h-8 text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="text-xs ml-1">{isAr ? "مسح" : "Clear"}</span>
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {activeService === "trim" && (
        <Card className="studio-panel border-cyan-accent/30">
          <CardHeader className="py-2"><CardTitle className="text-sm flex items-center gap-2"><Crop className="h-4 w-4 text-cyan-accent" />{isAr ? "وكيل قص الفيديو" : "Video Trim"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>{isAr ? "ارفع الفيديو للقص" : "Upload Video to Trim"}</span>
                  <span className="text-[9px] text-emerald-500 font-normal">{isAr ? "بلا حدود" : "No size limit"}</span>
                </Label>
                <div className="relative">
                  {!trimFile ? (
                    <div onClick={() => trimInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[120px] rounded-md bg-black/30 border border-dashed border-cyan-accent/30 hover:bg-black/40 transition-colors">
                      <UploadCloud className="h-8 w-8 text-cyan-accent" />
                      <p className="text-xs mt-2">{isAr ? "ارفع أي فيديو" : "Upload any video"}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{isAr ? "MP4، 3GP، AVI، MOV..." : "MP4, 3GP, AVI, MOV..."}</p>
                      <input
                        ref={trimInputRef}
                        type="file"
                        accept={ACCEPT_ATTR}
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) {
                            setTrimFile(f);
                            setTrimResult(null);
                            setTrimProgress(null);
                            // Auto-generate a browser-playable preview for non-browser-playable formats
                            generatePreview(f, "trim");
                          }
                          e.target.value = "";
                        }}
                      />
                    </div>
                  ) : (
                    <div className="relative rounded overflow-hidden bg-black/50">
                      {(() => {
                        const v = getVideoSrc(trimFile, "trim");
                        if (v.isPlayable && v.src) {
                          return <video src={v.src} controls className="w-full max-h-[200px]" />;
                        }
                        if (v.loading) {
                          return (
                            <div className="p-4 text-center">
                              <Loader2 className="h-6 w-6 animate-spin text-cyan-accent mx-auto mb-2" />
                              <p className="text-xs font-medium">{trimFile.name}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{fmtBytes(trimFile.size)} · {trimFile.name.split(".").pop()?.toUpperCase()}</p>
                              <p className="text-[10px] text-cyan-accent mt-1">
                                {isAr
                                  ? v.phase === "uploading" ? `جارٍ رفع... ${v.progress || 0}%` : "جارٍ توليد معاينة..."
                                  : v.phase === "uploading" ? `Uploading... ${v.progress || 0}%` : "Generating preview..."}
                              </p>
                              {(v.progress !== undefined && v.progress > 0) && (
                                <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden max-w-[200px] mx-auto">
                                  <div className="h-full bg-cyan-accent transition-all" style={{ width: `${v.progress}%` }} />
                                </div>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div className="p-4 text-center">
                            <Film className="h-8 w-8 text-cyan-accent mx-auto mb-2" />
                            <p className="text-xs font-medium">{trimFile.name}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{fmtBytes(trimFile.size)} · {trimFile.name.split(".").pop()?.toUpperCase()}</p>
                          </div>
                        );
                      })()}
                      <button onClick={() => { setTrimFile(null); setTrimResult(null); setTrimProgress(null); }} className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center z-10">
                        <X className="h-3.5 w-3.5 text-white" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "طريقة القص" : "Trim Mode"}</Label>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setTrimMode("remove")}
                    className={cn("flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-medium", trimMode === "remove" ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                  >
                    <Crop className="h-3.5 w-3.5" />
                    {isAr ? "حذف المقطع" : "Remove Section"}
                  </button>
                  <button
                    onClick={() => setTrimMode("keep")}
                    className={cn("flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-medium", trimMode === "keep" ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {isAr ? "استخراج المقطع" : "Keep Section"}
                  </button>
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {trimMode === "remove"
                    ? (isAr ? "يحذف المقطع المحدد ويدمج الجزء الأول مع المتبقي" : "Removes the selected section and merges the rest")
                    : (isAr ? "يستخرج المقطع المحدد فقط كملف منفصل" : "Extracts just the selected section as a separate file")}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "وقت البداية (ثانية)" : "Start Time (seconds)"}</Label>
                <input
                  type="number"
                  value={trimStart}
                  onChange={e => setTrimStart(Math.max(0, parseFloat(e.target.value) || 0))}
                  min="0"
                  step="0.1"
                  className="w-full h-9 px-2 rounded-md bg-black/30 border border-cyan-accent/30 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-accent"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "وقت النهاية (ثانية)" : "End Time (seconds)"}</Label>
                <input
                  type="number"
                  value={trimEnd}
                  onChange={e => setTrimEnd(Math.max(trimStart + 0.1, parseFloat(e.target.value) || 0))}
                  min="0"
                  step="0.1"
                  className="w-full h-9 px-2 rounded-md bg-black/30 border border-cyan-accent/30 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-accent"
                />
                <p className="text-[9px] text-muted-foreground">
                  {isAr ? `المدة المقصوصة: ${Math.max(0, trimEnd - trimStart).toFixed(1)} ثانية` : `Section to ${trimMode === "remove" ? "remove" : "keep"}: ${Math.max(0, trimEnd - trimStart).toFixed(1)}s`}
                </p>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleTrim} disabled={!trimFile || !!busy} className="flex-1 h-10 text-sm bg-cyan-accent text-black hover:bg-cyan-accent/90">
                  {busy === "trim" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crop className="h-4 w-4" />}
                  {isAr ? "قص الفيديو" : "Trim Video"}
                </Button>
                {busy === "trim" && (
                  <Button variant="outline" onClick={handleCancelTrim} className="h-10 px-3 text-red-400">
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {renderProgress(trimProgress, "trim")}
              {trimResult && (
                <div className="space-y-2">
                  <div className="rounded overflow-hidden bg-black/50 ring-1 ring-cyan-accent/30">
                    {trimResult.url?.match(PLAYABLE) ? (
                      <video src={trimResult.url} controls className="w-full max-h-[220px]" />
                    ) : (
                      <img src={trimResult.url} alt="trimmed" className="w-full max-h-[220px] object-contain" />
                    )}
                  </div>
                  <div className="p-2 rounded-md bg-muted/30 text-[10px] text-muted-foreground">
                    <p>{trimResult.note || (isAr ? "تم القص" : "Trimmed")}</p>
                    {trimResult.duration && <p>{isAr ? "المدة:" : "Duration:"} {fmtTime(trimResult.duration)}</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => {
                      const a = document.createElement("a");
                      a.href = trimResult.url;
                      a.download = `trimmed-${Date.now()}`;
                      a.click();
                    }} className="h-8">
                      <Download className="h-3.5 w-3.5" />
                      <span className="text-xs ml-1">{isAr ? "تحميل" : "Download"}</span>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setTrimResult(null); setTrimProgress(null); }} className="h-8 text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {activeService === "merge" && (
        <Card className="studio-panel border-cyan-accent/30">
          <CardHeader className="py-2"><CardTitle className="text-sm flex items-center gap-2"><Merge className="h-4 w-4 text-cyan-accent" />{isAr ? "وكيل دمج الفيديوهات" : "Video Merge"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-3">
              {/* Transition selector */}
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">{isAr ? "الانتقال بين المقاطع" : "Transition Between Clips"}</Label>
                <div className="grid grid-cols-5 gap-1">
                  {TRANSITIONS.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setMergeTransition(t.value)}
                      className={cn("flex flex-col items-center py-1.5 rounded text-[9px]", mergeTransition === t.value ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                      title={t.en}
                    >
                      <span className="text-base">{t.icon}</span>
                      {isAr ? t.ar : t.en}
                    </button>
                  ))}
                </div>
              </div>

              {/* File list — each uploaded file appears here, and a new "Add" box appears at the end */}
              <div className="space-y-2">
                <Label className="text-[11px] text-muted-foreground">
                  {isAr ? `الملفات (${mergeFiles.length})` : `Files (${mergeFiles.length})`}
                </Label>
                {/* Always-rendered hidden input — ref is always valid for both states */}
                <input
                  ref={mergeInputRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) addMergeFile(f);
                    e.target.value = "";
                  }}
                />
                {mergeFiles.length === 0 && (
                  <div onClick={() => mergeInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[100px] rounded-md bg-black/30 border border-dashed border-cyan-accent/30 hover:bg-black/40 transition-colors">
                    <Plus className="h-7 w-7 text-cyan-accent" />
                    <p className="text-xs mt-2">{isAr ? "أضف أول فيديو" : "Add first video"}</p>
                  </div>
                )}

                {mergeFiles.map((item, idx) => (
                  <div key={idx} className="space-y-1 p-2 rounded-md bg-muted/30 ring-1 ring-cyan-accent/20">
                    <div className="flex items-center gap-2">
                      <div className="shrink-0 h-7 w-7 rounded-full bg-cyan-accent/15 ring-1 ring-cyan-accent/40 flex items-center justify-center text-[10px] font-mono text-cyan-accent">
                        {String(idx + 1).padStart(2, "0")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-mono break-all">{item.file.name}</p>
                        <p className="text-[9px] text-muted-foreground">{fmtBytes(item.file.size)}</p>
                      </div>
                      {item.status === "uploading" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-accent shrink-0" />
                      )}
                      <button onClick={() => cancelMergeUpload(idx)} className="shrink-0 h-6 w-6 rounded-md bg-red-500/15 hover:bg-red-500/30 ring-1 ring-red-500/40 flex items-center justify-center">
                        <X className="h-3 w-3 text-red-400" />
                      </button>
                    </div>
                    {/* Per-file progress bar */}
                    {item.status === "uploading" && mergeFileProgress[idx] && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                          <span>{Math.round(mergeFileProgress[idx]!.progress || 0)}% · {(mergeFileProgress[idx]!.speedMBs || 0).toFixed(1)} MB/s · ETA {fmtTime(mergeFileProgress[idx]!.etaSeconds || 0)}</span>
                        </div>
                        <div className="h-1 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-cyan-accent transition-all" style={{ width: `${mergeFileProgress[idx]!.progress}%` }} />
                        </div>
                      </div>
                    )}
                    {item.status === "done" && (
                      <p className="text-[9px] text-emerald-500">✓ {isAr ? "تم الرفع" : "Uploaded"}</p>
                    )}
                    {item.status === "error" && (
                      <p className="text-[9px] text-red-500">✗ {isAr ? "خطأ" : "Error"}</p>
                    )}
                  </div>
                ))}

                {/* Add another file box — always appears after the first file */}
                {mergeFiles.length > 0 && (
                  <div onClick={() => mergeInputRef.current?.click()} className="flex items-center justify-center gap-2 cursor-pointer min-h-[44px] rounded-md bg-black/20 border border-dashed border-cyan-accent/20 hover:bg-black/30 transition-colors">
                    <Plus className="h-4 w-4 text-cyan-accent" />
                    <p className="text-[11px] text-cyan-accent">{isAr ? `أضف فيديو رقم ${mergeFiles.length + 1}` : `Add video #${mergeFiles.length + 1}`}</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={handleMerge} disabled={mergeFiles.length < 2 || !!busy} className="flex-1 h-10 text-sm bg-cyan-accent text-black hover:bg-cyan-accent/90">
                  {busy === "merge" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Merge className="h-4 w-4" />}
                  {isAr ? `ادمج ${mergeFiles.length} فيديو` : `Merge ${mergeFiles.length} videos`}
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              {renderProgress(mergeProgress, "merge")}
              {mergeResult && (
                <div className="space-y-2">
                  <div className="rounded overflow-hidden bg-black/50 ring-1 ring-cyan-accent/30">
                    {mergeResult.url?.match(PLAYABLE) ? (
                      <video src={mergeResult.url} controls className="w-full max-h-[220px]" />
                    ) : (
                      <img src={mergeResult.url} alt="merged" className="w-full max-h-[220px] object-contain" />
                    )}
                  </div>
                  <div className="p-2 rounded-md bg-muted/30 text-[10px] text-muted-foreground">
                    <p>{mergeResult.note || (isAr ? "تم الدمج" : "Merged")}</p>
                    <p>{isAr ? "الطريقة:" : "Method:"} {mergeResult.method}</p>
                    {mergeResult.size && <p>{isAr ? "الحجم:" : "Size:"} {fmtBytes(mergeResult.size)}</p>}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => {
                      const a = document.createElement("a");
                      a.href = mergeResult.url;
                      a.download = `merged-${Date.now()}.mp4`;
                      a.click();
                    }} className="h-8">
                      <Download className="h-3.5 w-3.5" />
                      <span className="text-xs ml-1">{isAr ? "تحميل" : "Download"}</span>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setMergeResult(null); setMergeProgress(null); setMergeFiles([]); mergeSessionId.current = `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }} className="h-8 text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="text-xs ml-1">{isAr ? "مسح الكل" : "Clear All"}</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* === CONVERT CARD (format conversion + enhancement) === */}
      {activeService === "convert" && (
        <Card className="studio-panel border-cyan-accent/30">
          <CardHeader className="py-2"><CardTitle className="text-sm flex items-center gap-2"><ArrowRight className="h-4 w-4 text-cyan-accent" />{isAr ? "وكيل تحويل صيغة الفيديو" : "Video Convert"}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="space-y-3">
                {/* Upload */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground flex items-center justify-between">
                    <span>{isAr ? "ارفع الفيديو" : "Upload Video"}</span>
                    <span className="text-[9px] text-emerald-500 font-normal">{isAr ? "بلا حدود" : "No size limit"}</span>
                  </Label>
                  <div className="relative">
                    {!convertFile ? (
                      <div onClick={() => convertInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[120px] rounded-md bg-black/30 border border-dashed border-cyan-accent/30 hover:bg-black/40 transition-colors">
                        <UploadCloud className="h-8 w-8 text-cyan-accent" />
                        <p className="text-xs mt-2">{isAr ? "ارفع أي فيديو" : "Upload any video"}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {isAr ? "MP4، 3GP، AVI، MOV، MKV، WebM..." : "MP4, 3GP, AVI, MOV, MKV, WebM..."}
                        </p>
                        <input
                          ref={convertInputRef}
                          type="file"
                          accept={ACCEPT_ATTR}
                          className="hidden"
                          onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) {
                              setConvertFile(f);
                              setConvertResult(null);
                              setConvertProgress(null);
                              generatePreview(f, "convert");
                            }
                            e.target.value = "";
                          }}
                        />
                      </div>
                    ) : (
                      <div className="relative rounded overflow-hidden bg-black/50">
                        {(() => {
                          const v = getVideoSrc(convertFile, "convert");
                          if (v.isPlayable && v.src) {
                            return <video src={v.src} controls className="w-full max-h-[180px]" />;
                          }
                          if (v.loading) {
                            return (
                              <div className="p-4 text-center">
                                <Loader2 className="h-6 w-6 animate-spin text-cyan-accent mx-auto mb-2" />
                                <p className="text-xs font-medium">{convertFile.name}</p>
                                <p className="text-[10px] text-cyan-accent mt-1">
                                  {isAr
                                    ? v.phase === "uploading" ? `جارٍ رفع... ${v.progress || 0}%` : "جارٍ توليد معاينة..."
                                    : v.phase === "uploading" ? `Uploading... ${v.progress || 0}%` : "Generating preview..."}
                                </p>
                              </div>
                            );
                          }
                          return (
                            <div className="p-4 text-center">
                              <Film className="h-8 w-8 text-cyan-accent mx-auto mb-2" />
                              <p className="text-xs font-medium">{convertFile.name}</p>
                              <p className="text-[10px] text-muted-foreground mt-1">{fmtBytes(convertFile.size)} · {convertFile.name.split(".").pop()?.toUpperCase()}</p>
                            </div>
                          );
                        })()}
                        <button onClick={() => { setConvertFile(null); setConvertResult(null); setConvertProgress(null); }} className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center z-10">
                          <X className="h-3.5 w-3.5 text-white" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Target format dropdown */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">{isAr ? "الصيغة المستهدفة" : "Target Format"}</Label>
                  <select
                    value={convertTargetFormat}
                    onChange={e => setConvertTargetFormat(e.target.value)}
                    className="w-full h-9 px-2 rounded-md bg-black/30 border border-cyan-accent/30 text-[11px] focus:outline-none focus:ring-1 focus:ring-cyan-accent"
                  >
                    {VIDEO_FORMATS.map(f => (
                      <option key={f.value} value={f.value} className="bg-background text-foreground">
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[9px] text-muted-foreground">
                    {isAr ? "21 صيغة مدعومة: MP4, WebM, MKV, MOV, AVI, FLV, WMV, 3GP, 3G2, OGV, TS, MPEG, MPG, M2TS, VOB, MTS, GIF, MJPEG, F4V, ASF, M4V" : "21 formats: MP4, WebM, MKV, MOV, AVI, FLV, WMV, 3GP, 3G2, OGV, TS, MPEG, MPG, M2TS, VOB, MTS, GIF, MJPEG, F4V, ASF, M4V"}
                  </p>
                </div>

                {/* Quality dropdown */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">{isAr ? "مستوى الجودة" : "Quality Level"}</Label>
                  <div className="grid grid-cols-4 gap-1">
                    {QUALITY_LEVELS.map(q => (
                      <button
                        key={q.value}
                        onClick={() => setConvertQuality(q.value)}
                        className={cn("py-1.5 rounded text-[10px] font-medium", convertQuality === q.value ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                      >
                        {isAr ? q.ar : q.en}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Upscale dropdown */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">{isAr ? "معامل التكبير" : "Upscale Factor"}</Label>
                  <div className="grid grid-cols-5 gap-1">
                    {UPSCALE_FACTORS.map(u => (
                      <button
                        key={u.value}
                        onClick={() => setConvertUpscale(u.value)}
                        className={cn("py-1.5 rounded text-[10px] font-medium", convertUpscale === u.value ? "bg-cyan-accent/15 ring-1 ring-cyan-accent/40 text-cyan-accent" : "bg-muted/30")}
                      >
                        {u.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Enhancement toggles */}
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">{isAr ? "خيارات التحسين" : "Enhancement Options"}</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { state: convertDenoise, set: setConvertDenoise, ar: "إزالة الضوضاء", en: "Denoise", icon: "🔇" },
                      { state: convertSharpen, set: setConvertSharpen, ar: "زيادة الحدة", en: "Sharpen", icon: "🔬" },
                      { state: convertColorEnhance, set: setConvertColorEnhance, ar: "تحسين الألوان", en: "Color Enhance", icon: "🎨" },
                      { state: convertBoost, set: setConvertBoost, ar: "تعزيز التباين", en: "Boost", icon: "⚡" },
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
                  <Button onClick={handleConvert} disabled={!convertFile || !!busy} className="flex-1 h-10 text-sm bg-cyan-accent text-black hover:bg-cyan-accent/90">
                    {busy === "convert" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    {isAr ? "حوّل الفيديو" : "Convert Video"}
                  </Button>
                  {busy === "convert" && (
                    <Button variant="outline" onClick={handleCancelConvert} className="h-10 px-3 text-red-400">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress + result */}
              <div className="space-y-3">
                {renderProgress(convertProgress, "convert")}
                {convertResult && (
                  <div className="space-y-2">
                    <div className="rounded overflow-hidden bg-black/50 ring-1 ring-cyan-accent/30">
                      {convertResult.url?.match(PLAYABLE) ? (
                        <video src={convertResult.url} controls className="w-full max-h-[220px]" />
                      ) : (
                        <img src={convertResult.url} alt="converted" className="w-full max-h-[220px] object-contain" />
                      )}
                    </div>
                    <div className="p-2 rounded-md bg-muted/30 text-[10px] text-muted-foreground space-y-0.5">
                      <p>{convertResult.note || (isAr ? "تم التحويل" : "Converted")}</p>
                      <p>{isAr ? "الأداة:" : "Tool:"} {convertResult.method}</p>
                      <p>{isAr ? "الحجم الأصلي:" : "Original:"} {fmtBytes(convertResult.originalSize)}</p>
                      <p>{isAr ? "الحجم المحوّل:" : "Converted:"} {fmtBytes(convertResult.convertedSize)}</p>
                      {convertResult.targetWidth > 0 && <p>{isAr ? "الأبعاد:" : "Dimensions:"} {convertResult.targetWidth}×{convertResult.targetHeight}</p>}
                      {convertResult.sourceDuration > 0 && <p>{isAr ? "المدة:" : "Duration:"} {fmtTime(convertResult.sourceDuration)}</p>}
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => {
                        const a = document.createElement("a");
                        a.href = convertResult.url;
                        a.download = `converted-${Date.now()}.${convertResult.format}`;
                        a.click();
                      }} className="h-8">
                        <Download className="h-3.5 w-3.5" />
                        <span className="text-xs ml-1">{isAr ? "تحميل" : "Download"}</span>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setConvertResult(null); setConvertProgress(null); }} className="h-8 text-red-400">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ============================================================================
 * VideoSwapService — video face swap / garment swap with NUMBERED BOXES.
 *
 * mode="face":
 *   1. Upload a video → the server extracts a poster frame and detects faces
 *   2. Upload a REFERENCE IMAGE (صورة المرجع) → faces detected + numbered
 *   3. Map: video face ③ ← reference face ②  (merge ref face onto that person)
 *   4. Processing: per-frame face swap with centroid tracking (inswapper)
 *
 * mode="garment":
 *   Same numbered-boxes flow, but the boxes mark the person's TORSO and the
 *   processing recolors the clothing of the selected video person toward the
 *   dominant color of the reference person's garment (folds/shading kept).
 * ========================================================================== */

type SwapBox = { index: number; bbox: [number, number, number, number]; score?: number };

function SwapNumberBox({
  box,
  number,
  mapped,
  onClick,
  accent,
}: {
  box: [number, number, number, number];
  number: number;
  mapped: boolean;
  onClick: () => void;
  accent: "cyan" | "fuchsia";
}) {
  const borderCls = mapped
    ? "border-emerald-400 bg-emerald-400/10"
    : accent === "cyan"
      ? "border-cyan-300/90 bg-cyan-300/5"
      : "border-fuchsia-400/80 bg-fuchsia-400/5";
  const badgeCls = mapped ? "bg-emerald-500" : accent === "cyan" ? "bg-cyan-500" : "bg-fuchsia-500";
  const [x1, y1, x2, y2] = box;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`الرقم ${number} — انقر للتعيين`}
      className="absolute z-20 group cursor-pointer"
      style={{
        left: `${x1 * 100}%`,
        top: `${y1 * 100}%`,
        width: `${Math.max(0, (x2 - x1) * 100)}%`,
        height: `${Math.max(0, (y2 - y1) * 100)}%`,
      }}
    >
      <span className={`absolute inset-0 rounded-md border-2 ${borderCls} group-hover:bg-emerald-400/25 transition-colors shadow-[0_0_0_1px_rgba(0,0,0,0.2)]`} />
      <span
        className={`absolute min-w-[20px] h-[20px] px-1 rounded-full text-[10px] font-extrabold text-white flex items-center justify-center shadow-md ${badgeCls} ${
          y1 < 0.06 ? "top-0.5 start-0.5" : "-top-2 -start-2"
        }`}
      >
        {number}
      </span>
    </button>
  );
}

function VideoSwapService({
  mode,
  onStateChange,
  registerReset,
}: {
  mode: "face" | "garment";
  onStateChange: (has: boolean) => void;
  registerReset: (fn: () => void) => void;
}) {
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const isAr = locale === "ar";
  const isFace = mode === "face";
  const accent = isFace ? "text-cyan-accent" : "text-fuchsia-400";

  // --- video state ---
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [videoPath, setVideoPath] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [videoBoxes, setVideoBoxes] = useState<SwapBox[]>([]);
  const [detectingVideo, setDetectingVideo] = useState(false);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // --- reference image state (صورة المرجع) ---
  const refInputRef = useRef<HTMLInputElement>(null);
  const [refUrl, setRefUrl] = useState("");
  const [refPath, setRefPath] = useState("");
  const [refBoxes, setRefBoxes] = useState<SwapBox[]>([]);
  const [detectingRef, setDetectingRef] = useState(false);

  // --- mapping + task state ---
  const [mappings, setMappings] = useState<{ videoIndex: number; refIndex: number }[]>([{ videoIndex: 0, refIndex: 0 }]);
  const [activeRow, setActiveRow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [taskPct, setTaskPct] = useState(0);
  const [taskPhase, setTaskPhase] = useState("");
  const [taskFrames, setTaskFrames] = useState<{ done: number; total: number } | null>(null);
  const [taskEta, setTaskEta] = useState(0);
  const swapStartRef = useRef<{ t: number; frames: number } | null>(null);
  const [result, setResult] = useState<{ url: string; posterUrl?: string; processedFrames?: number; fps?: number } | null>(null);

  const detectMode = isFace ? "faces" : "persons";

  // Report state to the parent (for the switch-service warning dialog)
  useEffect(() => {
    onStateChange(!!videoFile || !!videoPath || !!refUrl || !!result || busy || uploading);
  }, [videoFile, videoPath, refUrl, result, busy, uploading, onStateChange]);

  // Register a reset() the parent can call when switching services
  useEffect(() => {
    registerReset(() => {
      xhrRef.current?.abort();
      setVideoFile(null); setVideoPath(""); setPosterUrl(""); setVideoBoxes([]);
      setRefUrl(""); setRefPath(""); setRefBoxes([]);
      setMappings([{ videoIndex: 0, refIndex: 0 }]); setActiveRow(0);
      setBusy(false); setTaskPct(0); setTaskPhase(""); setResult(null);
      setUploadPct(0); setUploading(false);
    });
  }, [registerReset]);

  /* ---------- helpers ---------- */

  const pollTask = async (taskId: string, onProgress: (pct: number, phase: string, extra?: any) => void, maxMs = 35 * 60 * 1000) => {
    const t0 = Date.now();
    let misses = 0; // consecutive poll failures (network hiccup / server restart)
    let lastPct = -1;
    let lastChange = Date.now();
    while (Date.now() - t0 < maxMs) {
      await new Promise((r) => setTimeout(r, 1000));
      let d: any = null;
      try {
        const r = await fetch(`/api/task/status?id=${taskId}`, { cache: "no-store" });
        d = await r.json().catch(() => null);
        if (r.status === 404) {
          // Task vanished (dev-server restart wipes in-memory tasks) — fail fast
          // with a clear message instead of silently spinning forever.
          throw new Error("انقطع الاتصال بالمهمة (خادم المعالجة أُعيد تشغيله) — أعد المحاولة");
        }
        misses = 0;
      } catch (err) {
        if (err instanceof Error && err.message.includes("انقطع الاتصال")) throw err;
        if (++misses >= 20) throw new Error("انقطع الاتصال بالخادم أثناء المعالجة — أعد المحاولة");
        continue;
      }
      if (!d) continue;
      // Update the bar whenever the server reports progress (the old code
      // required `d.phase` which the status API never returned → frozen at 2%).
      if (d.progress != null && d.progress !== lastPct) {
        lastPct = d.progress;
        lastChange = Date.now();
        onProgress(d.progress, d.phase ?? "", d);
      }
      // Watchdog: server-side processing alive but ZERO progress for 3 min
      if (d.status === "processing" && Date.now() - lastChange > 180_000) {
        throw new Error("توقفت المعالجة عن التقدم (جمود طويل) — أعد المحاولة أو جرّب فيديو أقصر");
      }
      if (d.status === "done") return d.result ?? {};
      if (d.status === "error") throw new Error(d.error || "فشلت العملية");
    }
    throw new Error("انتهت المهلة");
  };

  const detectBoxes = async (imagePath: string, kind: "faces" | "persons"): Promise<SwapBox[]> => {
    const r = await fetch("/api/images/face-detect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath, mode: kind }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) return (kind === "faces" ? d.faces : d.persons) ?? [];
    return [];
  };

  /* ---------- video upload flow (raw stream like other video services) ---------- */

  const handleVideoPicked = (file: File) => {
    setVideoFile(file);
    setVideoPath(""); setPosterUrl(""); setVideoBoxes([]);
    setResult(null); setUploadPct(0); setUploading(true);
    setMappings([{ videoIndex: 0, refIndex: 0 }]);

    const url = `/api/video/face-swap?mode=upload&filename=${encodeURIComponent(file.name)}&size=${file.size}`;
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", url);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setUploadPct(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = async () => {
      try {
        const d = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 400 || !d.taskId) throw new Error(d.message || d.error || `HTTP ${xhr.status}`);
        const res = await pollTask(d.taskId, (pct, phase) => {
          setUploadPct(100);
          setTaskPhase(phase);
          setTaskPct(pct);
        }, 5 * 60 * 1000);
        setVideoPath(res.videoPath || "");
        setPosterUrl(res.posterUrl || "");
        setVideoBoxes((isFace ? res.faces : res.persons) || []);
        setUploading(false);
        setTaskPhase(""); setTaskPct(0);
        const n = ((isFace ? res.faces : res.persons) || []).length;
        toast({
          title: isAr
            ? `✅ تم رصد ${n} ${isFace ? "وجه" : "شخص"} في الفيديو`
            : `✅ Detected ${n} ${isFace ? "faces" : "persons"} in video`,
        });
      } catch (err) {
        setUploading(false);
        setTaskPhase(""); setTaskPct(0);
        toast({ title: isAr ? "فشل رفع الفيديو" : "Upload failed", description: String(err), variant: "destructive" });
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      toast({ title: isAr ? "فشل رفع الفيديو" : "Upload failed", variant: "destructive" });
    };
    xhr.send(file);
  };

  /* ---------- reference image flow ---------- */

  const readAsDataUrl = (file: Blob) =>
    new Promise<string>((resolve) => {
      const a = new FileReader();
      a.onload = () => resolve(a.result as string);
      a.readAsDataURL(file);
    });

  const handleRefPicked = async (file: File) => {
    try {
      const dataUrl = await readAsDataUrl(file);
      setRefUrl(dataUrl);
      setRefBoxes([]);
      const fd = new FormData();
      fd.append("file", file, `video-ref-${mode}.png`);
      const up = await fetch("/api/images/upload", { method: "POST", body: fd });
      const d = await up.json();
      if (up.ok && d.url) {
        setRefPath(d.url);
        setDetectingRef(true);
        const boxes = await detectBoxes(d.url, detectMode);
        setRefBoxes(boxes);
        setMappings([{ videoIndex: 0, refIndex: 0 }]);
        setActiveRow(0);
        setDetectingRef(false);
        if (!boxes.length) {
          toast({
            title: isAr ? "لم يُرصد أشخاص في المرجع" : "No persons in reference",
            description: isAr ? "استخدم صورة تظهر فيها وجوه واضحة" : "Use an image with clear faces",
          });
        }
      } else {
        throw new Error(d.error || "upload failed");
      }
    } catch (err) {
      setDetectingRef(false);
      toast({ title: isAr ? "فشل رفع المرجع" : "Reference upload failed", description: String(err), variant: "destructive" });
    }
  };

  const redetectVideoFrame = async () => {
    if (!videoPath) return;
    setDetectingVideo(true);
    try {
      const r = await fetch("/api/video/frame-detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setPosterUrl(d.posterUrl || posterUrl);
        setVideoBoxes((isFace ? d.faces : d.persons) || []);
        setMappings([{ videoIndex: 0, refIndex: 0 }]);
        toast({ title: isAr ? "🔄 تم إعادة الرصد" : "🔄 Re-detected" });
      }
    } finally {
      setDetectingVideo(false);
    }
  };

  /* ---------- mapping helpers ---------- */

  const setInActiveRow = (kind: "video" | "ref", idx: number) => {
    setMappings((ms) => {
      if (!ms.length) return ms;
      const i = Math.min(activeRow, ms.length - 1);
      const next = [...ms];
      next[i] = kind === "video" ? { ...next[i], videoIndex: idx } : { ...next[i], refIndex: idx };
      return next;
    });
  };

  const mappedVideoSet = new Set(mappings.map((mm) => mm.videoIndex));
  const mappedRefSet = new Set(mappings.map((mm) => mm.refIndex));

  /* ---------- start processing ---------- */

  const startProcessing = async () => {
    if (!videoPath || !refPath) return;
    setBusy(true); setTaskPct(2); setTaskPhase("prepare"); setResult(null);
    setTaskFrames(null); setTaskEta(0); swapStartRef.current = null;
    try {
      const r = await fetch("/api/video/face-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPath, refPath, mappings, mode, maxFrames: 400 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.taskId) throw new Error(d.message || d.error || `HTTP ${r.status}`);
      const res = await pollTask(d.taskId, (pct, phase, x) => {
        setTaskPct(pct); setTaskPhase(phase);
        // Frame counter + live ETA from processedFrames/totalFrames
        if (x?.totalFrames > 0 && x?.processedFrames != null) {
          const done = x.processedFrames;
          const now = Date.now();
          const st = swapStartRef.current;
          if (!st && done > 0) swapStartRef.current = { t: now, frames: done };
          else if (st && done > st.frames) {
            const rate = (done - st.frames) / ((now - st.t) / 1000); // frames/sec
            if (rate > 0.001) setTaskEta(Math.max(1, Math.round((x.totalFrames - done) / rate)));
          }
          setTaskFrames({ done, total: x.totalFrames });
        }
      }, 40 * 60 * 1000);
      setResult(res);
      toast({ title: isAr ? "✅ اكتملت المعالجة" : "✅ Processing complete" });
    } catch (err) {
      toast({ title: isAr ? "فشل تبديل الفيديو" : "Video swap failed", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false); setTaskPhase(""); setTaskPct(0);
      setTaskFrames(null); setTaskEta(0); swapStartRef.current = null;
    }
  };

  const labelVideo = isFace ? (isAr ? "وجه فيديو" : "Video face") : isAr ? "شخص فيديو" : "Video person";
  const labelRef = isFace ? (isAr ? "مرجع" : "Reference") : isAr ? "ملابس مرجع" : "Ref garment";
  const bothDetected = videoBoxes.length > 0 && refBoxes.length > 0;

  return (
    <Card className="studio-panel border-cyan-accent/30">
      <CardHeader className="py-2">
        <CardTitle className={cn("text-sm flex items-center gap-2", accent)}>
          {isFace ? <Users className="h-4 w-4" /> : <Shirt className="h-4 w-4" />}
          {isAr
            ? isFace ? "وكيل تبديل الوجوه في الفيديو" : "وكيل تبديل الملابس في الفيديو"
            : isFace ? "Video Face Swap Agent" : "Video Garment Swap Agent"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* ---- Step 1: video upload ---- */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">1.</span>{" "}
            {isAr ? (isFace ? "ارفع الفيديو (يُرصد الوجوه تلقائياً)" : "ارفع الفيديو (يُرصد الأشخاص تلقائياً)") : isFace ? "Upload video (faces auto-detected)" : "Upload video (persons auto-detected)"}
          </Label>
          {!videoFile ? (
            <div onClick={() => videoInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[110px] rounded-md bg-black/30 border border-dashed border-cyan-accent/30 hover:bg-black/40 transition-colors">
              <UploadCloud className="h-8 w-8 text-cyan-accent" />
              <p className="text-xs mt-2">{isAr ? "ارفع أي فيديو" : "Upload any video"}</p>
              <p className="text-[9px] text-emerald-500 mt-1">
                {isAr ? "يُنصح بفيديو ≤ 15 ثانية للمعالجة الأسرع" : "Videos ≤ 15s process faster"}
              </p>
              <input ref={videoInputRef} type="file" accept={ACCEPT_ATTR} className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoPicked(f); e.target.value = ""; }} />
            </div>
          ) : (
            <div className="space-y-2">
              {/* Poster with numbered boxes */}
              <div className="relative rounded overflow-hidden bg-black/50">
                <div className="relative w-fit max-w-full mx-auto">
                  {posterUrl ? (
                    <img src={posterUrl} alt="frame" className="block max-w-full max-h-[260px] w-auto h-auto" />
                  ) : (
                    <div className="min-h-[120px] flex items-center justify-center text-[11px] text-muted-foreground px-4 text-center">
                      {uploading ? `${videoFile.name} · ${fmtBytes(videoFile.size)}` : videoFile.name}
                    </div>
                  )}
                  {posterUrl && videoBoxes.map((bx) => (
                    <SwapNumberBox key={`v-${bx.index}`} box={bx.bbox} number={bx.index + 1} accent="cyan"
                      mapped={mappedVideoSet.has(bx.index)}
                      onClick={() => setInActiveRow("video", bx.index)} />
                  ))}
                  {detectingVideo && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-6 w-6 animate-spin text-cyan-accent" />
                    </div>
                  )}
                </div>
                <button onClick={() => { setVideoFile(null); setVideoPath(""); setPosterUrl(""); setVideoBoxes([]); setResult(null); }}
                  className="absolute top-1 right-1 h-7 w-7 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center z-30">
                  <X className="h-3.5 w-3.5 text-white" />
                </button>
                <div className="absolute bottom-1 left-1 px-2 py-0.5 rounded bg-black/70 text-[10px] text-white/80">
                  {videoFile.name} · {fmtBytes(videoFile.size)}
                </div>
              </div>
              {/* status line */}
              {(uploading || busy) && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{uploading ? (isAr ? "جارٍ الرفع..." : "Uploading...") : (taskPhase === "encoding" ? (isAr ? "ترميز الفيديو..." : "Encoding...") : isAr ? "جارٍ المعالجة..." : "Processing...")}</span>
                    <span className="font-mono">
                      {!uploading && taskFrames && taskFrames.total > 0
                        ? `${taskFrames.done}/${taskFrames.total} ${isAr ? "إطار" : "frames"}${taskEta > 0 ? ` · ~${taskEta >= 60 ? `${Math.floor(taskEta / 60)}:${String(taskEta % 60).padStart(2, "0")}` : `0:${String(taskEta).padStart(2, "0")}`}` : ""}`
                        : `${taskPct || uploadPct}%`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-cyan-accent transition-all" style={{ width: `${uploading ? uploadPct : taskPct}%` }} />
                  </div>
                  {!uploading && taskPhase === "processing" && isAr && !taskFrames && (
                    <p className="text-[9px] text-muted-foreground">قد تستغرق المعالجة عدة دقائق حسب طول الفيديو — تابع النسبة أعلاه</p>
                  )}
                </div>
              )}
              {videoPath && !busy && (
                <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={redetectVideoFrame} disabled={detectingVideo}>
                  <RefreshCw className={cn("h-3 w-3 me-1", detectingVideo && "animate-spin")} />
                  {isAr ? "إعادة رصد إطار الفيديو" : "Re-detect frame"}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* ---- Step 2: reference image ---- */}
        <div className="space-y-1.5">
          <Label className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">2.</span>{" "}
            {isAr
              ? isFace ? "الصورة المرجع (الوجه المراد دمجه)" : "الصورة المرجع (الملابس المراد نقلها)"
              : isFace ? "Reference image (face to merge)" : "Reference image (garment to transfer)"}
          </Label>
          {!refUrl ? (
            <div onClick={() => refInputRef.current?.click()} className="flex flex-col items-center justify-center cursor-pointer min-h-[90px] rounded-md bg-black/30 border border-dashed border-fuchsia-400/30 hover:bg-black/40 transition-colors">
              <UploadCloud className="h-6 w-6 text-fuchsia-400" />
              <p className="text-xs mt-1.5">{isAr ? "ارفع صورة المرجع" : "Upload reference image"}</p>
              <input ref={refInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRefPicked(f); e.target.value = ""; }} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="relative rounded overflow-hidden bg-black/50 w-fit max-w-full mx-auto">
                <div className="relative w-fit max-w-full">
                  <img src={refUrl} alt="reference" className="block max-w-full max-h-[200px] w-auto h-auto" />
                  {refBoxes.map((bx) => (
                    <SwapNumberBox key={`r-${bx.index}`} box={bx.bbox} number={bx.index + 1} accent="fuchsia"
                      mapped={mappedRefSet.has(bx.index)}
                      onClick={() => setInActiveRow("ref", bx.index)} />
                  ))}
                  {detectingRef && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-6 w-6 animate-spin text-fuchsia-400" />
                    </div>
                  )}
                </div>
                <button onClick={() => { setRefUrl(""); setRefPath(""); setRefBoxes([]); }}
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/70 hover:bg-red-500/80 flex items-center justify-center z-30">
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ScanFace className={cn("h-3 w-3", refBoxes.length ? "text-emerald-500" : "")} />
                <span>
                  {detectingRef
                    ? (isAr ? "جارٍ الرصد..." : "Detecting...")
                    : refBoxes.length
                      ? (isAr ? `رُصد ${refBoxes.length}` : `Detected ${refBoxes.length}`)
                      : (isAr ? "لم يُرصد أشخاص" : "No persons detected")}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ---- Step 3: mapping ---- */}
        {bothDetected && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-950/10 p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Link2 className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-[11px] font-bold">{isAr ? "ربط المربعات" : "Box mapping"}</span>
            </div>
            {mappings.map((mm, i) => (
              <div key={i} onClick={() => setActiveRow(i)}
                className={cn("flex items-center gap-1.5 p-1.5 rounded-md border cursor-pointer",
                  i === activeRow ? "border-emerald-400 bg-emerald-400/10" : "border-border/60 bg-background/40")}>
                <span className="text-[10px] font-bold text-muted-foreground w-3.5 text-center">{i + 1}.</span>
                <select value={mm.refIndex}
                  onChange={(e) => setMappings((ms) => { const n = [...ms]; n[i] = { ...n[i], refIndex: Number(e.target.value) }; return n; })}
                  className="h-6.5 h-7 rounded-md border border-fuchsia-300/60 bg-background text-[10px] px-1 flex-1">
                  {refBoxes.map((b) => <option key={b.index} value={b.index}>{labelRef} {b.index + 1}</option>)}
                </select>
                <ArrowLeft className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <select value={mm.videoIndex}
                  onChange={(e) => setMappings((ms) => { const n = [...ms]; n[i] = { ...n[i], videoIndex: Number(e.target.value) }; return n; })}
                  className="h-7 rounded-md border border-cyan-300/60 bg-background text-[10px] px-1 flex-1">
                  {videoBoxes.map((b) => <option key={b.index} value={b.index}>{labelVideo} {b.index + 1}</option>)}
                </select>
                {mappings.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); setMappings((ms) => ms.filter((_, di) => di !== i)); setActiveRow(0); }}
                    className="w-6 h-6 rounded-md flex items-center justify-center text-red-400 hover:bg-red-500/10 shrink-0">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            <Button size="sm" variant="outline" className="h-6.5 h-7 w-full text-[10px]"
              onClick={() => { setMappings((ms) => [...ms, { videoIndex: 0, refIndex: 0 }]); setActiveRow(mappings.length); }}
              disabled={mappings.length >= 6}>
              <Plus className="h-3 w-3 me-1" />
              {isAr ? "إضافة ربط آخر" : "Add mapping"}
            </Button>
            <p className="text-[9px] text-muted-foreground leading-relaxed">
              {isAr
                ? "انقر صف الربط ثم انقر المربعات المرقمة في الفيديو والمرجع. ① دائماً الأكبر. الرقم ① في الفيديو يتبع أول إطار."
                : "Click a mapping row, then click numbered boxes on the video frame and reference. ① is always the largest."}
            </p>
            {!isFace && (
              <p className="text-[9px] text-amber-500 leading-relaxed">
                {isAr
                  ? "ملاحظة: تبديل الملابس في الفيديو يعمل بنقل لون ملابس المرجع مع الحفاظ على ظلال وتجاعيد القماش."
                  : "Note: video garment swap transfers the reference garment's color while keeping folds and shading."}
              </p>
            )}
          </div>
        )}

        {/* ---- Step 4: start ---- */}
        <Button onClick={startProcessing} disabled={!videoPath || !refPath || !bothDetected || busy || uploading}
          className={cn("w-full h-10 text-sm font-semibold", isFace ? "bg-cyan-accent text-black hover:bg-cyan-accent/90" : "bg-fuchsia-500 text-white hover:bg-fuchsia-600")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isFace ? <Users className="h-4 w-4" /> : <Shirt className="h-4 w-4" />}
          {isAr ? (isFace ? "ابدأ تبديل الوجوه" : "ابدأ تبديل الملابس") : isFace ? "Start face swap" : "Start garment swap"}
        </Button>

        {/* ---- Result ---- */}
        {result?.url && (
          <div className="space-y-2">
            <div className="rounded overflow-hidden bg-black/50 ring-1 ring-emerald-500/40">
              {result.url.match(PLAYABLE) ? (
                <video src={result.url} controls className="w-full max-h-[260px]" />
              ) : (
                <img src={result.posterUrl || result.url} alt="result" className="w-full max-h-[260px] object-contain" />
              )}
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{isAr ? `عولج ${result.processedFrames ?? "—"} إطار` : `${result.processedFrames ?? "—"} frames processed`}</span>
              <button onClick={() => { const a = document.createElement("a"); a.href = result.url; a.download = `video-${mode}-swap-${Date.now()}.mp4`; a.click(); }}
                className="flex items-center gap-1 text-cyan-accent hover:underline">
                <Download className="h-3 w-3" />
                {isAr ? "تحميل" : "Download"}
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
