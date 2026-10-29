"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

/**
 * EnhanceQualityButtons
 *
 * Renders 5 quality-level buttons (HD / FHD / 2K / 4K / ULTRA) under any image.
 * Clicking a button immediately calls POST /api/images/enhance with that
 * quality setting, then calls `onEnhanced(result)` with the response so
 * the parent can update its image state.
 *
 * This is the SAME enhance pipeline used by the Image Tools panel's
 * "Enhance Quality" card — calls the same /api/images/enhance endpoint
 * with the same body shape { sourcePath, quality }.
 *
 * Props:
 *   sourcePath — server-side file path returned from /api/images/upload
 *   onEnhanced — callback with the API response (url, path, width, height, ...)
 *   size — button size variant ("sm" | "default")
 *   disabled — disable all buttons
 */
type QualityKey = "hd" | "fullHd" | "twoK" | "fourK" | "ultraHd";

const QUALITY_LEVELS: Array<{
  k: QualityKey;
  l: string;
  tooltipAr: string;
  tooltipEn: string;
  subtitle: string;
}> = [
  { k: "hd", l: "HD", tooltipAr: "HD - 1280p", tooltipEn: "HD - 1280p", subtitle: "1280p" },
  { k: "fullHd", l: "FHD", tooltipAr: "Full HD - 1920p", tooltipEn: "Full HD - 1920p", subtitle: "1920p" },
  { k: "twoK", l: "2K", tooltipAr: "2K - 2560p", tooltipEn: "2K - 2560p", subtitle: "2560p" },
  { k: "fourK", l: "4K", tooltipAr: "4K - 3840p", tooltipEn: "4K - 3840p", subtitle: "3840p" },
  { k: "ultraHd", l: "ULTRA", tooltipAr: "Ultra HD - 7680p (8K)", tooltipEn: "Ultra HD - 7680p (8K)", subtitle: "7680p" },
];

export interface EnhancedResult {
  url: string;
  path: string;
  width: number;
  height: number;
  size: number;
  quality: QualityKey;
  qualityLabel: string;
  method: string;
}

interface Props {
  sourcePath: string;
  onEnhanced: (result: EnhancedResult) => void;
  disabled?: boolean;
  /** Visual variant: "compact" (small inline) | "card" (full card style) */
  variant?: "compact" | "card";
  className?: string;
}

export function EnhanceQualityButtons({
  sourcePath,
  onEnhanced,
  disabled = false,
  variant = "compact",
  className,
}: Props) {
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [busy, setBusy] = useState<QualityKey | null>(null);

  const handleEnhance = async (q: QualityKey) => {
    if (!sourcePath || busy !== null || disabled) return;
    setBusy(q);
    try {
      let finalPath = sourcePath;

      // Strip cache-bust query params (e.g. "/results/foo.png?t=123" → "/results/foo.png")
      if (sourcePath.includes("?")) {
        finalPath = sourcePath.split("?")[0];
      }

      if (finalPath.startsWith("data:")) {
        // Data URL → upload to server, then enhance
        const blob = await (await fetch(finalPath)).blob();
        const fd = new FormData();
        fd.append("file", blob, "enhance-source.png");
        const uploadRes = await fetch("/api/images/upload", { method: "POST", body: fd });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.path) {
          throw new Error(locale === "ar" ? "فشل رفع الصورة للتحسين" : "Upload failed for enhance");
        }
        finalPath = uploadData.path;
      } else if (finalPath.startsWith("/results/") || finalPath.startsWith("/uploads/")) {
        // Relative URL → pass as-is. resolveFilePath will find it.
        // (already stripped query params above)
      } else if (finalPath.startsWith("/api/") || finalPath.startsWith("http")) {
        // API URL or full HTTP URL → fetch as blob then upload
        const blob = await (await fetch(finalPath)).blob();
        const fd = new FormData();
        fd.append("file", blob, "enhance-source.png");
        const uploadRes = await fetch("/api/images/upload", { method: "POST", body: fd });
        const uploadData = await uploadRes.json();
        if (uploadRes.ok && uploadData.path) {
          finalPath = uploadData.path;
        }
      }

      const r = await fetch("/api/images/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: finalPath, quality: q }),
      });
      const d = await r.json();
      if (r.ok) {
        const result: EnhancedResult = {
          url: d.url,
          path: d.path,
          width: d.width,
          height: d.height,
          size: d.size,
          quality: d.quality,
          qualityLabel: d.qualityLabel,
          method: d.method,
        };
        onEnhanced(result);
        toast({
          title: locale === "ar" ? "تم التحسين" : "Enhanced",
          description: `${d.width}×${d.height} · ${d.qualityLabel} (${d.method})`,
        });
      } else {
        toast({
          title: locale === "ar" ? "خطأ في التحسين" : "Enhance failed",
          description: d.message ?? d.error ?? `HTTP ${r.status} — sourcePath: ${finalPath}`,
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: locale === "ar" ? "خطأ" : "Error",
        description: e instanceof Error ? e.message : "unknown",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  if (variant === "card") {
    return (
      <div className={cn("studio-panel p-3 border border-panel-border rounded-md", className)}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-cyan-accent" />
          <span className="text-xs font-semibold">
            {locale === "ar" ? "تحسين الجودة" : "Enhance Quality"}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {QUALITY_LEVELS.map((q) => (
            <button
              key={q.k}
              onClick={() => void handleEnhance(q.k)}
              disabled={disabled || busy !== null}
              title={locale === "ar" ? q.tooltipAr : q.tooltipEn}
              className={cn(
                "px-1 py-1.5 rounded text-[10px] font-medium transition-all",
                "bg-muted/30 hover:bg-cyan-accent/20 hover:text-cyan-accent",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                busy === q.k && "bg-cyan-accent/30 ring-1 ring-cyan-accent"
              )}
            >
              {busy === q.k ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : q.l}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Compact variant — small inline buttons
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
        <Sparkles className="h-3 w-3 text-cyan-accent" />
        <span>{locale === "ar" ? "تحسين الجودة" : "Enhance"}</span>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {QUALITY_LEVELS.map((q) => (
          <button
            key={q.k}
            onClick={() => void handleEnhance(q.k)}
            disabled={disabled || busy !== null}
            title={locale === "ar" ? q.tooltipAr : q.tooltipEn}
            className={cn(
              "px-1 py-1 rounded text-[10px] font-medium transition-all",
              "bg-muted/30 hover:bg-cyan-accent/20 hover:text-cyan-accent",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              busy === q.k && "bg-cyan-accent/30 ring-1 ring-cyan-accent"
            )}
          >
            {busy === q.k ? <Loader2 className="h-3 w-3 animate-spin mx-auto" /> : q.l}
          </button>
        ))}
      </div>
    </div>
  );
}
