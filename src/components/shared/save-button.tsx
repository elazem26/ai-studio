"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, Save } from "lucide-react";

/**
 * SaveButton
 *
 * Reusable image-save button.
 *
 * Takes either:
 *   - `sourcePath` (absolute path) — used directly
 *   - `url` (e.g. "/uploads/foo.png" or "/results/bar.png") —
 *      resolves to absolute path via the project's data root.
 *
 * Calls /api/images/export to produce a downloadable file,
 * then triggers a browser download.
 */

interface SaveButtonProps {
  /** Absolute server path (preferred) */
  sourcePath?: string;
  /** Or public URL — we'll derive the path from it */
  url?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Compact variant — icon only */
  variant?: "default" | "compact";
  /** Optional className */
  className?: string;
  /** Optional filename override (without extension) */
  filename?: string;
}

export function SaveButton({
  sourcePath,
  url,
  disabled,
  variant = "default",
  className,
  filename,
}: SaveButtonProps) {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const isAr = locale === "ar";

  /**
   * Derive the file path from a public URL.
   * URL pattern: "/uploads/abc.png" or "/results/xyz.png"
   * Pass the URL directly — the /api/images/export endpoint uses
   * resolveFilePath which checks multiple paths including
   * process.cwd()/data/ (which is /home/z/my-project/extracted/data/).
   *
   * Previous version used `/home/z/my-project/data/${rel}` which was
   * WRONG (the actual path is /home/z/my-project/extracted/data/).
   */
  const derivePath = (url: string): string => {
    if (!url.startsWith("/")) return url;
    // Just pass the relative URL — resolveFilePath will find it
    return url;
  };

  const handleSave = async () => {
    const path = sourcePath || (url ? derivePath(url) : "");
    if (!path || disabled || busy) return;

    setBusy(true);
    try {
      // Call export API with PNG + maximum quality
      const res = await fetch("/api/images/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: path,
          format: "png",
          quality: "maximum",
          resolution: "original",
          dpi: 300,
        }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        // Trigger browser download
        const a = document.createElement("a");
        a.href = data.url;
        a.download = `${filename ?? "saved-image"}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast({
          title: t("success.saved"),
          description: `${data.size ? Math.round(data.size / 1024) : 0} KB`,
        });
      } else {
        toast({
          title: isAr ? "فشل الحفظ" : "Save failed",
          description: data.message,
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
      setBusy(false);
    }
  };

  if (variant === "compact") {
    return (
      <button
        onClick={handleSave}
        disabled={disabled || busy || (!sourcePath && !url)}
        className={cn(
          "flex items-center justify-center h-7 w-7 rounded-md text-[10px] font-medium transition-all",
          "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30 hover:bg-cyan-accent/25",
          (disabled || busy || (!sourcePath && !url)) && "opacity-40 cursor-not-allowed",
          className
        )}
        title={isAr ? "حفظ الصورة" : "Save image"}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
      </button>
    );
  }

  return (
    <button
      onClick={handleSave}
      disabled={disabled || busy || (!sourcePath && !url)}
      className={cn(
        "flex items-center gap-1 h-8 px-3 rounded-md text-[11px] font-medium transition-all",
        "bg-cyan-accent text-black hover:bg-cyan-accent/90",
        (disabled || busy || (!sourcePath && !url)) && "opacity-40 cursor-not-allowed",
        className
      )}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
      <span>{isAr ? "حفظ" : "Save"}</span>
    </button>
  );
}
