"use client";

import { useCallback, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import type { UploadedImage } from "@/stores/image-store";
import { cn } from "@/lib/utils";
import { UploadCloud, Loader2 } from "lucide-react";

interface DropZoneProps {
  onUploaded: (img: UploadedImage) => void;
  variant: "source" | "garment";
  disabled?: boolean;
  /** Compact mode for smaller containers */
  compact?: boolean;
}

const ACCEPT = ".jpg,.jpeg,.png,.webp,.tiff,image/jpeg,image/png,image/webp,image/tiff";

export function ImageDropZone({ onUploaded, variant, disabled, compact }: DropZoneProps) {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (disabled || uploading) return;
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/images/upload", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) {
          toast({
            title: t("errors.invalidImage"),
            description: t(data?.error ?? "errors.unknown"),
            variant: "destructive",
          });
          return;
        }
        onUploaded(data as UploadedImage);
      } catch (e) {
        toast({
          title: t("errors.unknown"),
          description: e instanceof Error ? e.message : "Network error",
          variant: "destructive",
        });
      } finally {
        setUploading(false);
      }
    },
    [disabled, uploading, onUploaded, toast, t, locale]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const openPicker = useCallback(() => {
    if (disabled || uploading) return;
    inputRef.current?.click();
  }, [disabled, uploading]);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 rounded-lg border-2 border-dashed select-none",
        compact ? "min-h-[160px] px-3 py-4" : "min-h-[260px] px-6 py-10",
        isDragging
          ? "border-cyan-accent bg-cyan-accent/5 scale-[1.01]"
          : "border-panel-border bg-studio-inset hover:border-cyan-accent/40 hover:bg-cyan-accent/[0.03]",
        disabled && "opacity-50 pointer-events-none"
      )}
      onClick={openPicker}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openPicker();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = "";
        }}
      />
      <div
        className={cn(
          "rounded-full flex items-center justify-center mb-3 transition-colors",
          compact ? "h-10 w-10" : "h-14 w-14",
          isDragging ? "bg-cyan-accent/20" : "bg-cyan-accent/10"
        )}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 text-cyan-accent animate-spin" />
        ) : (
          <UploadCloud className={compact ? "h-4 w-4" : "h-6 w-6"} />
        )}
      </div>
      <p className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
        {variant === "source"
          ? t("panels.source.dropHere")
          : t("panels.garment.dropHere")}
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        {variant === "source" ? t("panels.source.orBrowse") : t("common.browse")}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="px-2 py-0.5 rounded-sm bg-muted">
          {variant === "source"
            ? t("panels.source.supportedFormats")
            : t("panels.garment.supportedFormats")}
        </span>
        <span className="px-2 py-0.5 rounded-sm bg-muted">
          {variant === "source" ? t("panels.source.maxSize") : "25MB max"}
        </span>
      </div>
    </div>
  );
}
