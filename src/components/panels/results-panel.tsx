"use client";

import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import { useUIStore } from "@/stores/ui-store";
import { useTryOnStore } from "@/stores/tryon-store";
import { useUndoRedoStore } from "@/stores/undo-redo-store";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EnhanceQualityButtons, type EnhancedResult } from "@/components/shared/enhance-quality-buttons";
import { ChatAgent } from "@/components/shared/chat-agent";
import { ProgressIndicator } from "@/components/shared/progress-indicator";
import {
  ImageOff,
  ZoomIn,
  ZoomOut,
  Download,
  Printer,
  Sparkles,
  Trash2,
  RefreshCw,
  Wand2,
  GitCompare,
  Images,
  Maximize2,
  Loader2,
  Undo2,
  Redo2,
  Save,
  X,
  ExternalLink,
  RotateCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ResultsPanel() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const results = useImageStore((s) => s.results);
  const activeResultId = useImageStore((s) => s.activeResultId);
  const setActiveResult = useImageStore((s) => s.setActiveResult);
  const removeResult = useImageStore((s) => s.removeResult);
  const pushStudioHistory = useImageStore((s) => s.pushStudioHistory);
  const isGenerating = useTryOnStore((s) => s.isGenerating);
  const percent = useTryOnStore((s) => s.percent);
  const stage = useTryOnStore((s) => s.stage);
  const stageLabel = useTryOnStore((s) => s.stageLabel);
  const setZoomModalOpen = useUIStore((s) => s.setZoomModalOpen);
  const setExportModalOpen = useUIStore((s) => s.setExportModalOpen);
  const setPrintModalOpen = useUIStore((s) => s.setPrintModalOpen);
  const setCompareOpen = useUIStore((s) => s.setCompareOpen);
  const { toast } = useToast();
  const [upscaling, setUpscaling] = useState(false);
  // Local zoom state for the active result image
  const [imageZoom, setImageZoom] = useState(1);

  const activeResult = results.find((r) => r.id === activeResultId) ?? results[0];

  const handleEnhance = async () => {
    if (!activeResult) return;
    setUpscaling(true);
    try {
      const res = await fetch("/api/images/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: activeResult.url,
          target: "ultraHd",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({
          title: t("success.generated"),
          description: `${data.width}×${data.height}`,
        });
        // Replace active result with upscaled version
        const ts = Date.now();
        pushStudioHistory(`Upscale: ${activeResult.id}`);
        useImageStore.getState().setResults(
          results.map((r) =>
            r.id === activeResult.id
              ? {
                  ...r,
                  url: data.url,
                  thumbnailUrl: data.url,
                  width: data.width,
                  height: data.height,
                }
              : r
          )
        );
      } else {
        toast({
          title: t("errors.generationFailed"),
          description: data.error,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: t("errors.unknown"),
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setUpscaling(false);
    }
  };

  // === Image overlay handlers (Save / Print / Open / Close / Zoom in / Zoom out) ===

  // Save the active result as a PNG file (browser download)
  const handleImageSave = useCallback(async () => {
    if (!activeResult) return;
    try {
      // Pass the result URL directly — the /api/images/export endpoint
      // uses resolveFilePath which checks multiple paths including
      // process.cwd()/data/ (which is /home/z/my-project/extracted/data/).
      //
      // Previous version used `/home/z/my-project/data/${rel}` which was
      // WRONG (the actual path is /home/z/my-project/extracted/data/).
      const urlPath = activeResult.url ?? "";
      const sourcePath =
        (activeResult as { path?: string }).path ||
        urlPath;  // just pass the URL — resolveFilePath will find it

      const res = await fetch("/api/images/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, format: "png", quality: "maximum", resolution: "original", dpi: 300 }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        const a = document.createElement("a");
        a.href = data.url;
        a.download = `result-${activeResult.id}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast({ title: t("success.saved"), description: `${activeResult.width}×${activeResult.height}` });
      } else {
        toast({ title: "Save failed", description: data.message, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: t("errors.unknown"), description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }, [activeResult, toast, t]);

  // Print the active result
  const handleImagePrint = useCallback(() => {
    if (!activeResult) return;
    setPrintModalOpen(true);
  }, [activeResult, setPrintModalOpen]);

  // Open the active result in a new browser tab (full size)
  const handleImageOpen = useCallback(() => {
    if (!activeResult) return;
    window.open(activeResult.url, "_blank", "noopener,noreferrer");
  }, [activeResult]);

  // Close (remove) the active result from the list
  const handleImageClose = useCallback(() => {
    if (!activeResult) return;
    pushStudioHistory(`Result removed: ${activeResult.id}`);
    removeResult(activeResult.id);
    setImageZoom(1); // reset zoom
    toast({ title: t("panels.results.deleted") || "Removed" });
  }, [activeResult, removeResult, toast, t, pushStudioHistory]);

  // Zoom in (max 10x = 1000%)
  const handleZoomIn = useCallback(() => {
    setImageZoom((z) => Math.min(10, z * 1.25));
  }, []);

  // Zoom out (min 1x = 100%, can't go smaller than fit-to-container)
  const handleZoomOut = useCallback(() => {
    setImageZoom((z) => Math.max(1, z * 0.8));
  }, []);

  // Reset zoom to 1 (fit-to-container)
  const handleZoomReset = useCallback(() => {
    setImageZoom(1);
  }, []);

  // Reset zoom when active result changes or new results are generated
  useEffect(() => {
    setImageZoom(1);
  }, [activeResultId]);

  return (
    <section className="studio-panel p-4 flex flex-col h-full">
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-full bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30 flex items-center justify-center text-xs font-bold">
            3
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-none">{t("panels.results.title")}</h2>
            <p className="text-[11px] text-muted-foreground mt-1">{t("panels.results.subtitle")}</p>
          </div>
        </div>
        {results.length > 0 && (
          <Badge variant="secondary" className="text-[10px] gap-1">
            <Images className="h-3 w-3" />
            {results.length}
          </Badge>
        )}
      </header>

      <div className="flex-1 min-h-0 studio-inset p-3 rounded-md flex flex-col">
        {/* Active image */}
        <div className="relative flex-1 min-h-[200px] rounded-md overflow-hidden bg-black/40 flex items-center justify-center">
          {isGenerating ? (
            <GeneratingOverlay percent={percent} stageLabel={stageLabel} stage={stage} />
          ) : activeResult ? (
            <>
              { }
              {/* Image with zoom support — wrapper allows scroll when zoomed in */}
              <div
                className="absolute inset-0 overflow-auto flex items-center justify-center"
                style={{ cursor: imageZoom > 1 ? "grab" : "default" }}
              >
                <div
                  className="flex items-center justify-center min-h-full min-w-full"
                  style={{
                    width: `${imageZoom * 100}%`,
                    height: `${imageZoom * 100}%`,
                  }}
                >
                  <img
                    src={activeResult.url}
                    alt="Generated result"
                    className="select-none pointer-events-none"
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      width: "auto",
                      height: "auto",
                      objectFit: "contain",
                      transition: "all 0.15s ease-out",
                    }}
                    draggable={false}
                  />
                </div>
              </div>

              {/* === OVERLAY TOOLBAR (top-right) — Save / Print / Open / Close === */}
              <div className="absolute top-2 right-2 (rtl:left-2 rtl:right-auto) flex items-center gap-1 z-10">
                <OverlayButton
                  onClick={handleImageSave}
                  icon={<Save className="h-3.5 w-3.5" />}
                  label={t("panels.results.download")}
                  variant="primary"
                />
                <OverlayButton
                  onClick={handleImagePrint}
                  icon={<Printer className="h-3.5 w-3.5" />}
                  label={t("panels.results.print")}
                  variant="primary"
                />
                <OverlayButton
                  onClick={handleImageOpen}
                  icon={<ExternalLink className="h-3.5 w-3.5" />}
                  label={locale === "ar" ? "فتح" : "Open"}
                  variant="primary"
                />
                <OverlayButton
                  onClick={handleImageClose}
                  icon={<X className="h-3.5 w-3.5" />}
                  label={locale === "ar" ? "إغلاق" : "Close"}
                  variant="danger"
                />
              </div>

              {/* === ZOOM TOOLBAR (top-left) — Zoom out / Reset / Zoom in + percentage === */}
              <div className="absolute top-2 left-2 (rtl:right-2 rtl:left-auto) flex items-center gap-1 z-10">
                <OverlayButton
                  onClick={handleZoomOut}
                  icon={<ZoomOut className="h-3.5 w-3.5" />}
                  label=""
                  variant="default"
                  disabled={imageZoom <= 1}
                  title={locale === "ar" ? "تصغير (لا أصغر من الحجم الأصلي)" : "Zoom out (min = original)"}
                />
                <OverlayButton
                  onClick={handleZoomReset}
                  icon={<RotateCw className="h-3.5 w-3.5" />}
                  label=""
                  variant="default"
                  title={locale === "ar" ? "إعادة ضبط" : "Reset zoom"}
                />
                <OverlayButton
                  onClick={handleZoomIn}
                  icon={<ZoomIn className="h-3.5 w-3.5" />}
                  label=""
                  variant="default"
                  disabled={imageZoom >= 10}
                  title={locale === "ar" ? "تكبير (حتى 1000%)" : "Zoom in (up to 1000%)"}
                />
                <div className="h-7 px-2 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-mono text-cyan-accent flex items-center justify-center ring-1 ring-white/20">
                  {Math.round(imageZoom * 100)}%
                </div>
              </div>

              {/* Image dimensions badge (bottom-right) */}
              <div className="absolute bottom-2 right-2 (rtl:left-2 rtl:right-auto) flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium">
                {activeResult.width} × {activeResult.height}
              </div>
            </>
          ) : (
            <EmptyResults />
          )}
        </div>

        {/* Thumbnail strip */}
        {results.length > 1 && (
          <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
            {results.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveResult(r.id)}
                className={cn(
                  "h-14 w-14 shrink-0 rounded-md overflow-hidden ring-1 transition-all",
                  r.id === activeResultId
                    ? "ring-cyan-accent ring-2"
                    : "ring-transparent hover:ring-cyan-accent/40"
                )}
              >
                { }
                <img src={r.thumbnailUrl ?? r.url} alt="" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}

        {/* PROMINENT ACTION BUTTONS - 2 rows for clarity */}
        {activeResult && !isGenerating && (
          <div className="mt-3 space-y-1.5">
            {/* Primary actions row */}
            <div className="grid grid-cols-4 gap-1.5">
              <ActionButton
                onClick={() => setZoomModalOpen(true)}
                icon={<ZoomIn className="h-4 w-4" />}
                label={t("panels.results.zoom")}
                primary
              />
              <ActionButton
                onClick={() => setCompareOpen(true)}
                icon={<GitCompare className="h-4 w-4" />}
                label={t("panels.results.compare")}
                primary
              />
              <ActionButton
                onClick={() => setExportModalOpen(true)}
                icon={<Download className="h-4 w-4" />}
                label={t("panels.results.download")}
                primary
              />
              <ActionButton
                onClick={() => setPrintModalOpen(true)}
                icon={<Printer className="h-4 w-4" />}
                label={t("panels.results.print")}
                primary
              />
            </div>

            {/* Secondary actions row */}
            <div className="grid grid-cols-3 gap-1.5">
              <ActionButton
                onClick={handleEnhance}
                icon={upscaling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                label={t("panels.results.enhance")}
                small
              />
              <ActionButton
                onClick={() => activeResult && removeResult(activeResult.id)}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={t("panels.results.delete")}
                small
                destructive
              />
              <ActionButton
                onClick={() => window.dispatchEvent(new CustomEvent("studio:regenerate"))}
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                label={t("panels.results.regenerate")}
                small
              />
            </div>
          </div>
        )}
      </div>
      {/* Progress indicator — shows during try-on generation */}
      <ProgressIndicator
        busy={isGenerating}
        className="mt-1"
      />
      {/* 5-level Enhance Quality buttons — same pipeline as Image Tools */}
      {activeResult && activeResult.url && (
        <EnhanceQualityButtons
          sourcePath={activeResult.url}
          onEnhanced={(result: EnhancedResult) => {
            if (!activeResult) return;
            pushStudioHistory(`Result enhanced: ${result.qualityLabel}`);
            // Replace the active result with the enhanced version
            useImageStore.getState().setResults(
              results.map((r) =>
                r.id === activeResult.id
                  ? {
                      ...r,
                      url: result.url,
                      thumbnailUrl: result.url,
                      width: result.width,
                      height: result.height,
                    }
                  : r
              )
            );
          }}
          variant="compact"
          className="mt-2"
        />
      )}

      {/* AI Agent — natural-language editor for the result image */}
      {activeResult && activeResult.url && (
        <ChatAgent
          image={{
            path: (activeResult as { path?: string }).path ?? activeResult.url,
            url: activeResult.url,
            width: activeResult.width,
            height: activeResult.height,
            name: activeResult.id,
          }}
          onUpdate={(d) => {
            if (!activeResult) return;
            pushStudioHistory(`Agent edit: ${activeResult.id}`);
            useImageStore.getState().setResults(
              results.map((r) =>
                r.id === activeResult.id
                  ? {
                      ...r,
                      url: d.url,
                      thumbnailUrl: d.url,
                      width: d.width,
                      height: d.height,
                    }
                  : r
              )
            );
          }}
          compact
          className="mt-2"
        />
      )}
    </section>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
  primary,
  small,
  destructive,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  small?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-md font-medium transition-all",
        small ? "h-9 text-[10px]" : "h-11 text-[11px]",
        primary
          ? "bg-cyan-accent/10 text-cyan-accent ring-1 ring-cyan-accent/30 hover:bg-cyan-accent/20 hover:ring-cyan-accent"
          : destructive
          ? "bg-destructive/10 text-destructive ring-1 ring-destructive/30 hover:bg-destructive/20"
          : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EmptyResults() {
  const t = useI18n((s) => s.t);
  return (
    <div className="flex flex-col items-center justify-center text-center px-4">
      <div className="h-14 w-14 rounded-full bg-muted/40 flex items-center justify-center mb-3">
        <ImageOff className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{t("panels.results.empty")}</p>
      <p className="text-[11px] text-muted-foreground/70 mt-1 max-w-[280px]">
        {t("panels.results.noResults")}
      </p>
    </div>
  );
}

function GeneratingOverlay({
  percent,
  stageLabel,
  stage,
}: {
  percent: number;
  stageLabel: string;
  stage: string;
}) {
  const t = useI18n((s) => s.t);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-sm">
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full bg-cyan-accent/10 animate-ping" />
        <div className="absolute inset-2 rounded-full bg-cyan-accent/15 flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-cyan-accent animate-pulse" />
        </div>
      </div>
      <div className="w-full max-w-[260px] px-4">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span>{t(stageLabel as never) || stage}</span>
          <span className="text-cyan-accent font-mono">{percent}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden relative">
          <div
            className="h-full bg-cyan-accent/80 rounded-full transition-all duration-200"
            style={{ width: `${percent}%` }}
          />
          <div className="absolute inset-0 progress-shimmer" />
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">{t("progress.step", { 0: stage })}</p>
    </div>
  );
}

/**
 * OverlayButton — small button that floats over the image.
 * Used for Save / Print / Open / Close / Zoom in / Zoom out / Reset
 */
function OverlayButton({
  onClick,
  icon,
  label,
  variant = "default",
  disabled = false,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  const variantCls =
    variant === "primary"
      ? "bg-cyan-accent/20 text-cyan-accent ring-1 ring-cyan-accent/40 hover:bg-cyan-accent/30"
      : variant === "danger"
      ? "bg-red-500/20 text-red-400 ring-1 ring-red-500/40 hover:bg-red-500/30"
      : "bg-black/70 text-white ring-1 ring-white/20 hover:bg-white/20";

  if (label === "") {
    // Icon-only button (used for zoom in/out/reset)
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(
          "h-7 w-7 rounded-md backdrop-blur-sm flex items-center justify-center transition-all",
          variantCls,
          disabled && "opacity-30 cursor-not-allowed"
        )}
      >
        {icon}
      </button>
    );
  }

  // Icon + label button (used for Save / Print / Open / Close)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "h-7 px-2 rounded-md backdrop-blur-sm flex items-center gap-1 transition-all text-[10px] font-medium",
        variantCls,
        disabled && "opacity-30 cursor-not-allowed"
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
