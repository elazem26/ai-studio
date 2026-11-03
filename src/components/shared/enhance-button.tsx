"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Sparkles, ChevronDown } from "lucide-react";

/**
 * EnhanceButton
 *
 * Reusable HD → ULTRA enhancement button.
 *
 * When clicked, calls /api/images/enhance with the chosen quality,
 * then updates the parent image via onUpdate().
 *
 * Used in: Image Tools, Face Swap (under each image),
 * Studio Results panel.
 */

type QualityKey = "hd" | "fullHd" | "twoK" | "fourK" | "ultraHd";

const QUALITY_LABELS: Record<QualityKey, { ar: string; en: string; tag: string }> = {
  hd:      { ar: "HD",       en: "HD",       tag: "1280p" },
  fullHd:  { ar: "فول HD",   en: "Full HD",  tag: "1920p" },
  twoK:    { ar: "2K",       en: "2K",       tag: "2560p" },
  fourK:   { ar: "4K",       en: "4K",       tag: "3840p" },
  ultraHd: { ar: "ULTRA",    en: "ULTRA",    tag: "7680p" },
};

interface EnhanceButtonProps {
  /** Absolute file path of the image to enhance */
  sourcePath: string;
  /** Called after a successful enhance with the new image data */
  onUpdate: (data: {
    path: string;
    url: string;
    width: number;
    height: number;
  }) => void;
  /** Disabled state */
  disabled?: boolean;
  /** Variant */
  variant?: "default" | "compact";
  /** Optional className */
  className?: string;
}

export function EnhanceButton({
  sourcePath,
  onUpdate,
  disabled,
  variant = "default",
  className,
}: EnhanceButtonProps) {
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<QualityKey>("ultraHd");

  const isAr = locale === "ar";

  const handleEnhance = async (q: QualityKey) => {
    if (!sourcePath || disabled || busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const r = await fetch("/api/images/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath, quality: q }),
      });
      const d = await r.json();
      if (r.ok) {
        onUpdate({
          path: d.path,
          url: d.url,
          width: d.width,
          height: d.height,
        });
        toast({
          title: isAr ? "تم التحسين الاحترافي" : "Professionally enhanced",
          description: `${d.width}×${d.height} · ${d.qualityLabel} · ${d.method}`,
        });
      } else {
        toast({
          title: isAr ? "خطأ في التحسين" : "Enhance failed",
          description: d.message,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: isAr ? "خطأ" : "Error",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  if (variant === "compact") {
    return (
      <button
        onClick={() => handleEnhance(quality)}
        disabled={disabled || busy || !sourcePath}
        className={cn(
          "flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-medium transition-all",
          "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30 hover:bg-cyan-accent/25",
          (disabled || busy || !sourcePath) && "opacity-40 cursor-not-allowed",
          className
        )}
        title={isAr ? "تحسين احترافي للجودة" : "Professional quality enhancement"}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        <span>{QUALITY_LABELS[quality][isAr ? "ar" : "en"]}</span>
      </button>
    );
  }

  return (
    <div className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || busy || !sourcePath}
        className={cn(
          "flex items-center gap-1 h-8 px-3 rounded-md text-[11px] font-medium transition-all",
          "bg-cyan-accent text-black hover:bg-cyan-accent/90",
          (disabled || busy || !sourcePath) && "opacity-40 cursor-not-allowed",
          className
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        <span>{isAr ? "تحسين" : "Enhance"}</span>
        <span className="text-[9px] opacity-70">{QUALITY_LABELS[quality].tag}</span>
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>
      {open && !disabled && !busy && (
        <div className="absolute top-full mt-1 left-0 z-20 w-32 rounded-md border border-border bg-popover shadow-lg overflow-hidden">
          {(Object.keys(QUALITY_LABELS) as QualityKey[]).map((q) => (
            <button
              key={q}
              onClick={() => {
                setQuality(q);
                setOpen(false);
                void handleEnhance(q);
              }}
              className={cn(
                "flex items-center justify-between w-full px-3 h-8 text-[11px] hover:bg-cyan-accent/15",
                quality === q && "bg-cyan-accent/10 text-cyan-accent"
              )}
            >
              <span>{QUALITY_LABELS[q][isAr ? "ar" : "en"]}</span>
              <span className="text-[9px] opacity-60">{QUALITY_LABELS[q].tag}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
