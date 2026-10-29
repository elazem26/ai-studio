"use client";

import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import { useTryOnStore } from "@/stores/tryon-store";
import { useSettingsStore, getEffectiveSettings } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { useModeStore } from "@/stores/mode-store";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useCallback, useRef, useState, useEffect } from "react";
import {
  Sparkles,
  XCircle,
  RefreshCw,
  SlidersHorizontal,
  Save,
  FolderOpen,
  Mic,
  Send,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdvancedSettings } from "@/components/settings/advanced-settings";
import { Progress } from "@/components/ui/progress";
import { ProjectSaveDialog } from "@/components/projects/project-save-dialog";
import { TargetSelector } from "@/components/shared/target-selector";
import { useGarmentMappingStore } from "@/stores/garment-mapping-store";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface HardwareSnapshot {
  preference: "cuda_high" | "cuda_mid" | "cuda_low" | "cpu";
  vramAvailableMB: number;
  cudaAvailable: boolean;
  cpu: string | null;
  ramTotalGB: number | null;
  gpu: string | null;
  vramTotalMB: number | null;
}

export function ControlBar() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const source = useImageStore((s) => s.source);
  const garment = useImageStore((s) => s.garment);
  const garmentList = useImageStore((s) => s.garmentList);
  const garmentDescription = useImageStore((s) => s.garmentDescription);
  const setResults = useImageStore((s) => s.setResults);
  const pushStudioHistory = useImageStore((s) => s.pushStudioHistory);
  const settings = useSettingsStore();
  const isGenerating = useTryOnStore((s) => s.isGenerating);
  const percent = useTryOnStore((s) => s.percent);
  const startGen = useTryOnStore((s) => s.start);
  const updateStep = useTryOnStore((s) => s.updateStep);
  const complete = useTryOnStore((s) => s.complete);
  const setError = useTryOnStore((s) => s.setError);
  const cancel = useTryOnStore((s) => s.cancel);
  const advancedOpen = useUIStore((s) => s.advancedOpen);
  const setAdvancedOpen = useUIStore((s) => s.setAdvancedOpen);
  const mode = useModeStore((s) => s.mode);
  const { toast } = useToast();
  const taskIdRef = useRef<string | null>(null);
  const [taskRunning, setTaskRunning] = useState(false);
  const [projectSaveOpen, setProjectSaveOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceInput, setVoiceInput] = useState("");
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Numbered-box swap mode state (for the badge + Generate routing)
  const swapEnabled = useGarmentMappingStore((s) => s.enabled);
  const swapMappings = useGarmentMappingStore((s) => s.mappings);
  const srcBoxCount = useGarmentMappingStore((s) => s.srcBoxes.length);
  const totalRefBoxCount = useGarmentMappingStore((s) =>
    s.refBoxesByImage.reduce((acc, b) => acc + (b?.length ?? 0), 0)
  );
  const refImageCount = garmentList.length || (garment ? 1 : 0);
  const swapModeActive =
    swapEnabled && refImageCount > 0 && srcBoxCount > 0 && totalRefBoxCount > 0 && swapMappings.length > 0;

  useEffect(() => {
    setVoiceSupported(typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window));
  }, []);

  /**
   * NUMBERED-BOX regional garment swap: sends the source + reference
   * with explicit person↔outfit mappings to /api/images/garment-swap
   * (regional precision pipeline — only the mapped torsos are edited).
   */
  const runBoxedSwap = useCallback(async () => {
    const mp = useGarmentMappingStore.getState();
    const imgStore = useImageStore.getState();
    const refImgs = imgStore.garmentList.length
      ? imgStore.garmentList
      : imgStore.garment
        ? [imgStore.garment]
        : [];
    if (!source || !refImgs.length || !mp.mappings.length) return;
    startGen();
    updateStep({
      stage: "analyzing",
      percent: 15,
      label: locale === "ar" ? "رصد الأشخاص والملابس…" : "Detecting persons & outfits…",
    });
    const startedAt = Date.now();
    try {
      updateStep({
        stage: "generating",
        percent: 10,
        label: locale === "ar" ? "بدء عملية التبديل…" : "Starting swap…",
      });
      // ASYNC MODE: the swap takes 40-90s in one request — the preview proxy
      // kills such long connections and the UI showed a false failure while
      // the server actually succeeded. So: start a background job (returns a
      // jobId in <1s), then poll its status with short-lived requests.
      const res = await fetch("/api/images/garment-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: source.path || source.url,
          // MULTI-REFERENCE: every mapping row points at its own image.
          garmentPaths: refImgs.map((g) => g.path || g.url),
          garmentPath: refImgs[0]?.path || refImgs[0]?.url, // legacy compat
          mappings: mp.mappings.map((m) => ({
            sourceIndex: m.sourceIndex,
            refIndex: m.refIndex,
            refImage: m.refImage ?? 0,
          })),
          async: true,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.jobId) {
        setError("errors.generationFailed", d.message || d.error);
        toast({
          title: locale === "ar" ? "فشل تبديل الملابس" : "Garment swap failed",
          description: d.message || d.error,
          variant: "destructive",
        });
        return;
      }

      // ---- Poll the job every 2.5s (each poll is fast & proxy-safe) ----
      const deadline = Date.now() + 12 * 60 * 1000; // 12 min hard cap
      let job: any = null;
      let pollOk = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const pr = await fetch(`/api/images/garment-swap?jobId=${encodeURIComponent(d.jobId)}`);
          const pj = await pr.json().catch(() => ({}));
          if (!pr.ok) {
            // 404 = unknown/expired job — a real failure, stop polling.
            if (pr.status === 404) { job = { status: "error", message: pj.message || pj.error }; pollOk = true; break; }
            continue; // transient poll error — keep polling
          }
          if (pj?.status === "running") {
            updateStep({
              stage: "generating",
              percent: Math.max(15, Math.min(95, Number(pj.percent) || 40)),
              label: locale === "ar" ? (pj.stageLabelAr || "جاري التبديل…") : (pj.stageLabelEn || "Swapping…"),
            });
            continue;
          }
          job = pj;
          pollOk = true;
          break;
        } catch {
          continue; // transient network error — keep polling
        }
      }

      if (!pollOk || !job) {
        setError("errors.generationFailed", locale === "ar" ? "انتهت مهلة الانتظار" : "Polling timeout");
        toast({
          title: locale === "ar" ? "فشل تبديل الملابس" : "Garment swap failed",
          description: locale === "ar" ? "انتهت مهلة انتظار النتيجة — حاول مجدداً." : "Timed out waiting for the result — try again.",
          variant: "destructive",
        });
        return;
      }
      if (job.status === "error") {
        setError("errors.generationFailed", job.message || job.error);
        toast({
          title: locale === "ar" ? "فشل تبديل الملابس" : "Garment swap failed",
          description: job.message || job.error,
          variant: "destructive",
        });
        return;
      }

      const r = job.result ?? {};
      const ts = Date.now();
      setResults([
        {
          id: `swap-${ts}`,
          url: r.url,
          thumbnailUrl: r.url,
          seed: "garment-swap-boxes",
          width: r.width,
          height: r.height,
          qualityScore: null,
          createdAt: ts,
        },
      ]);
      pushStudioHistory(`Garment swap (boxes): ${mp.mappings.length} mapping(s)`);
      complete({
        modelUsed: r.method ?? "zai-edit-regional-garment",
        durationMs: Date.now() - startedAt,
        qualityScore: undefined,
        qualityIssues: [],
      });
      toast({
        title: locale === "ar" ? "✅ تم تبديل الملابس بالمربعات" : "✅ Garment swapped (boxes)",
      });
    } catch (e) {
      setError("errors.unknown", e instanceof Error ? e.message : String(e));
      toast({
        title: locale === "ar" ? "فشل تبديل الملابس" : "Garment swap failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }, [source, startGen, updateStep, setResults, complete, setError, pushStudioHistory, toast, locale]);

  const handleGenerate = useCallback(async () => {
    if (!source) {
      toast({ title: t("errors.noSourceImage"), variant: "destructive" });
      return;
    }
    if (!garment && !garmentDescription.trim()) {
      toast({ title: t("errors.noGarmentImage"), variant: "destructive" });
      return;
    }
    // Numbered-box mode: route to the regional garment-swap pipeline
    // when enabled AND persons were detected on BOTH images.
    if (swapModeActive) {
      await runBoxedSwap();
      return;
    }
    startGen();

    try {
      const hwRes = await fetch("/api/gpu/status");
      const hw: HardwareSnapshot = await hwRes.json();

      const effective = getEffectiveSettings(settings);
      const res = await fetch("/api/tryon/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: source.path,
          garmentPath: garment?.path || undefined,
          garmentDescription: garmentDescription || undefined,
          // Choose model based on user's mode preference:
          //   "cloud" → Cloud AI (z-ai-web-dev-sdk)
          //   "local" → CatVTON Python backend (if installed)
          modelId: mode === "local" ? "catvton" : "cloud-ai",
          settings: {
            garmentFidelity: effective.garmentFidelity,
            identityPreservation: effective.identityPreservation,
            bodyPreservation: effective.bodyPreservation,
            lightingMatch: effective.lightingMatch,
            colorMatch: effective.colorMatch,
            textureFidelity: effective.textureFidelity,
            generationSteps: effective.generationSteps,
            guidance: effective.guidance,
            seed: effective.seed,
            resolution: effective.resolution,
            numResults: effective.numResults,
          },
          hardware: {
            preference: hw.preference,
            vramAvailableMB: hw.vramTotalMB ?? 0,
            cudaAvailable: hw.cudaAvailable,
          },
        }),
      });
      const data = (await res.json()) as {
        taskId?: string;
        error?: string;
        message?: string;
        modelId?: string;
      };
      if (!res.ok || !data.taskId) {
        setError(data.error ?? "errors.generationFailed", data.message);
        toast({
          title: t(data.error ?? "errors.generationFailed"),
          description: data.message,
          variant: "destructive",
        });
        return;
      }
      taskIdRef.current = data.taskId;
      setTaskRunning(true);

      // Poll /api/tryon/status every 400ms until done.
      // Polling works reliably across proxies/gateways (SSE doesn't always
      // propagate through reverse proxies without explicit config).
      const poll = async () => {
        const startedAt = Date.now();
        const maxMs = 5 * 60 * 1000; // 5-minute safety timeout
        while (taskIdRef.current === data.taskId) {
          if (Date.now() - startedAt > maxMs) {
            setError("errors.generationFailed", "timeout");
            setTaskRunning(false);
            taskIdRef.current = null;
            return;
          }
          try {
            const r = await fetch(`/api/tryon/status?id=${data.taskId}`);
            const payload = (await r.json()) as {
              done: boolean;
              steps: Array<{ stage: string; percent: number; labelKey: string; detail?: string; ts: number }>;
              result?: {
                success: boolean;
                results?: Array<{ url: string; thumbnailUrl?: string; width: number; height: number; seedUsed: string }>;
                errorKey?: string;
                errorMessage?: string;
                generationMs?: number;
                modelUsed?: string;
              } | null;
            };
            // Replay any new steps
            for (const step of payload.steps) {
              updateStep({
                stage: step.stage as never,
                percent: step.percent,
                label: step.labelKey,
              });
            }
            if (payload.done && payload.result) {
              const final = payload.result;
              if (final.success && final.results) {
                const ts = Date.now();
                setResults(
                  final.results.map((r) => ({
                    id: `${ts}-${Math.random().toString(36).slice(2, 6)}`,
                    url: r.url,
                    thumbnailUrl: r.thumbnailUrl ?? r.url,
                    seed: r.seedUsed,
                    width: r.width,
                    height: r.height,
                    qualityScore: null,
                    createdAt: ts,
                  }))
                );
                complete({
                  modelUsed: final.modelUsed ?? data.modelId ?? "catvton",
                  durationMs: final.generationMs ?? 0,
                  qualityScore: undefined,
                  qualityIssues: [],
                });
                toast({ title: t("success.generated") });
              } else {
                setError(
                  final.errorKey ?? "errors.generationFailed",
                  final.errorMessage
                );
                toast({
                  title: t(final.errorKey ?? "errors.generationFailed"),
                  description: final.errorMessage,
                  variant: "destructive",
                });
              }
              taskIdRef.current = null;
              setTaskRunning(false);
              return;
            }
          } catch (e) {
            // Network blip — try again next iteration
            console.warn("Status poll failed:", e);
          }
          // Sleep 400ms before next poll
          await new Promise((r) => setTimeout(r, 400));
        }
      };
      void poll();
    } catch (e) {
      setError("errors.unknown", e instanceof Error ? e.message : String(e));
      toast({
        title: t("errors.unknown"),
        description: e instanceof Error ? e.message : "error",
        variant: "destructive",
      });
    }
  }, [source, garment, garmentDescription, settings, mode, startGen, updateStep, complete, setError, setResults, toast, t, locale, swapModeActive, runBoxedSwap]);


  // Voice/Text Agent: takes natural language request and applies try-on
  const handleVoiceAgent = useCallback(async () => {
    if (!source || !voiceInput.trim()) return;
    setVoiceLoading(true);
    try {
      const res = await fetch("/api/tryon/voice-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: source.path,
          request: voiceInput.trim(),
          inputMode: "text",
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        const ts = Date.now();
        setResults([{
          id: `voice-${ts}`,
          url: data.url,
          thumbnailUrl: data.url,
          seed: "voice-agent",
          width: data.width,
          height: data.height,
          qualityScore: null,
          createdAt: ts,
        }]);
        toast({ title: t("success.generated"), description: data.translatedGarmentDescription?.slice(0, 80) });
        setVoiceOpen(false);
        setVoiceInput("");
      } else {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: t("errors.unknown"), description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setVoiceLoading(false);
    }
  }, [source, voiceInput, setResults, toast, t]);

  // Start voice recognition (Web Speech API)
  const startVoice = useCallback(() => {
    if (!voiceSupported) return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = locale === "ar" ? "ar-SA" : "en-US";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setVoiceInput(transcript);
    };
    rec.onerror = () => { toast({ title: "Voice error", variant: "destructive" }); };
    recognitionRef.current = rec;
    rec.start();
  }, [voiceSupported, locale, toast]);

  const handleCancel = useCallback(async () => {
    if (!taskIdRef.current) {
      cancel();
      return;
    }
    try {
      await fetch("/api/tryon/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: taskIdRef.current }),
      });
    } catch {
      /* ignore */
    }
    cancel();
    taskIdRef.current = null;
    setTaskRunning(false);
    toast({ title: t("progress.cancelled") });
  }, [cancel, toast, t]);

  return (
    <div className="studio-panel p-3 sm:p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          onClick={isGenerating || taskRunning ? handleCancel : handleGenerate}
          disabled={false}
          className={
            isGenerating || taskRunning
              ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-cyan-accent text-black hover:bg-cyan-accent/90 cyan-glow"
          }
          size="default"
        >
          {isGenerating || taskRunning ? (
            <>
              <XCircle className="h-4 w-4" />
              {t("controls.cancel")}
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {t("controls.generate")}
            </>
          )}
        </Button>

        <Button
          variant="outline"
          size="default"
          disabled={isGenerating || taskRunning}
          onClick={handleGenerate}
        >
          <RefreshCw className="h-4 w-4" />
          {t("controls.regenerate")}
        </Button>

        <Button
          variant={advancedOpen ? "secondary" : "ghost"}
          size="default"
          onClick={() => setAdvancedOpen(!advancedOpen)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {t("controls.advanced")}
        </Button>

        {settings.autoMode && (
          <Badge
            variant="outline"
            className="text-[10px] gap-1 text-cyan-accent border-cyan-accent/40"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-accent cyan-pulse" />
            {t("controls.auto")}
          </Badge>
        )}

        {swapEnabled && refImageCount > 0 && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] gap-1",
              swapModeActive
                ? "text-emerald-500 border-emerald-500/40"
                : "text-muted-foreground border-border"
            )}
          >
            <Link2 className="h-3 w-3" />
            {swapModeActive
              ? locale === "ar"
                ? `تبديل بالمربعات (${swapMappings.length})${refImageCount > 1 ? ` — ${refImageCount} مراجع` : ""}`
                : `Boxed swap (${swapMappings.length})${refImageCount > 1 ? ` — ${refImageCount} refs` : ""}`
              : locale === "ar"
                ? "المربعات: لا رصد"
                : "Boxes: no detection"}
          </Badge>
        )}

                <Button
          variant={voiceOpen ? "secondary" : "ghost"}
          size="default"
          onClick={() => setVoiceOpen(!voiceOpen)}
          className="bg-cyan-accent/10 hover:bg-cyan-accent/20 text-cyan-accent ring-1 ring-cyan-accent/30"
          disabled={!source || isGenerating || taskRunning}
          title={locale === "ar" ? "وكيل الذكاء — اكتب أو تحدث" : "AI Agent — type or speak"}
        >
          <Mic className="h-4 w-4" />
          <span className="hidden sm:inline">{locale === "ar" ? "وكيل" : "AI Agent"}</span>
        </Button>

<div className="flex-1" />

        <TargetSelector section="studio" />

        <Button
          variant="ghost"
          size="sm"
          className="text-[11px]"
          onClick={() => setProjectSaveOpen(true)}
          disabled={!source}
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("controls.saveProject")}</span>
        </Button>
        <Button variant="ghost" size="sm" className="text-[11px]" disabled title={t("controls.loadProject")}>
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("controls.loadProject")}</span>
        </Button>
      </div>

      {(isGenerating || taskRunning) && (
        <div className="flex items-center gap-2">
          <Progress value={percent} className="h-1.5 flex-1 bg-muted/60" />
          <span className="text-[10px] font-mono text-cyan-accent w-10 text-end">
            {percent}%
          </span>
        </div>
      )}

      {voiceOpen && source && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-black/30 border border-cyan-accent/20">
          {voiceSupported && (
            <Button variant="ghost" size="sm" onClick={startVoice} disabled={voiceLoading} className="h-9 w-9 p-0 shrink-0" title={locale === "ar" ? "اضغط للتحدث" : "Click to speak"}>
              <Mic className="h-4 w-4 text-cyan-accent" />
            </Button>
          )}
          <input
            value={voiceInput}
            onChange={(e) => setVoiceInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleVoiceAgent(); } }}
            placeholder={locale === "ar" ? "مثال: أريد بدلة زرقاء رسمية..." : "e.g., Put a blue formal suit on this person..."}
            className="flex-1 h-9 text-xs bg-black/40 border border-cyan-accent/30 rounded px-3 text-foreground placeholder:text-muted-foreground"
            disabled={voiceLoading}
          />
          <Button size="sm" onClick={handleVoiceAgent} disabled={voiceLoading || !voiceInput.trim()} className="h-9 px-3 bg-cyan-accent text-black hover:bg-cyan-accent/90 shrink-0">
            {voiceLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {locale === "ar" ? "نفّذ" : "Apply"}
          </Button>
        </div>
      )}

      {advancedOpen && <AdvancedSettings />}

      {projectSaveOpen && (
        <ProjectSaveDialog
          open={projectSaveOpen}
          onOpenChange={setProjectSaveOpen}
        />
      )}
    </div>
  );
}
