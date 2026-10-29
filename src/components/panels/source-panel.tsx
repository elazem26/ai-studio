"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useImageStore, type UploadedImage } from "@/stores/image-store";
import { ImageDropZone } from "./image-dropzone";
import { EnhanceQualityButtons, type EnhancedResult } from "@/components/shared/enhance-quality-buttons";
import { ChatAgent } from "@/components/shared/chat-agent";
import { Button } from "@/components/ui/button";
import {
  RotateCw,
  Crop,
  Trash2,
  RefreshCw,
  ImageIcon,
  Ruler,
  FileText,
  Palette,
  Replace,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ScanFace } from "lucide-react";
import { useGarmentMappingStore, type PersonBox } from "@/stores/garment-mapping-store";
import { usePersonAutoDetect } from "@/hooks/use-person-detect";
import { NumberedPersonBox } from "@/components/shared/numbered-person-box";

export function SourcePanel() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const source = useImageStore((s) => s.source);
  const setSource = useImageStore((s) => s.setSource);
  const pushStudioHistory = useImageStore((s) => s.pushStudioHistory);
  const [rotation, setRotation] = useState(0);
  const { toast } = useToast();
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Numbered-box garment swap: auto-detect persons on the source image
  // and keep the shared mapping store in sync.
  usePersonAutoDetect("source", source);
  const srcBoxes = useGarmentMappingStore((s) => s.srcBoxes);
  const detectingSrc = useGarmentMappingStore((s) => s.detecting.source);
  const mappings = useGarmentMappingStore((s) => s.mappings);
  const setInActiveRow = useGarmentMappingStore((s) => s.setInActiveRow);
  const mappedSrcSet = new Set(mappings.map((m) => m.sourceIndex));

  // Hidden input for replace flow (kept outside DropZone so the user
  // can also click the loaded image to trigger a replace)
  const handleReplace = (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/images/upload", { method: "POST", body: fd })
      .then((r) => r.json())
      .then((data) => {
        if (data.url) {
          pushStudioHistory(`Source: ${data.name ?? "image"}`);
          setSource(data as UploadedImage);
          toast({ title: t("success.imageUploaded") });
        } else {
          toast({ title: t(data.error ?? "errors.invalidImage"), variant: "destructive" });
        }
      })
      .catch(() => toast({ title: t("errors.unknown"), variant: "destructive" }));
  };

  return (
    <section className="studio-panel p-4 flex flex-col h-full">
      <PanelHeader
        title={t("panels.source.title")}
        subtitle={t("panels.source.subtitle")}
        badge="1"
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.tiff,image/jpeg,image/png,image/webp,image/tiff"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleReplace(f);
          e.target.value = "";
        }}
      />
      <div className="flex-1 mt-3 min-h-0">
        {!source ? (
          <ImageDropZone
            variant="source"
            onUploaded={(img) => {
              pushStudioHistory(`Source: ${img.name ?? "image"}`);
              setSource(img);
            }}
          />
        ) : (
          <SourceImagePreview
            image={source}
            rotation={rotation}
            boxes={srcBoxes}
            mappedSet={mappedSrcSet}
            detecting={detectingSrc}
            onBoxClick={(idx: number) => setInActiveRow("source", idx)}
            onRotate={() => setRotation((r) => (r + 90) % 360)}
            onResetRotation={() => setRotation(0)}
            onRemove={() => {
              pushStudioHistory("Source: removed");
              setSource(null);
              setRotation(0);
            }}
            onReplace={() => replaceInputRef.current?.click()}
          />
        )}
      </div>
      {/* 5-level Enhance Quality buttons — same pipeline as Image Tools */}
      {source && (
        <EnhanceQualityButtons
          sourcePath={source.path}
          onEnhanced={(result: EnhancedResult) => {
            pushStudioHistory(`Source enhanced: ${result.qualityLabel}`);
            // Replace the current source image with the enhanced version
            setSource({
              ...source,
              url: result.url,
              path: result.path,
              width: result.width,
              height: result.height,
              size: result.size,
            });
          }}
          variant="compact"
          className="mt-2"
        />
      )}

      {/* AI Agent — natural-language editor for the source image */}
      {source && (
        <ChatAgent
          image={source}
          onUpdate={(d) => {
            pushStudioHistory(`Agent edit: ${source.name}`);
            setSource({
              ...source,
              url: d.url,
              path: d.path,
              width: d.width,
              height: d.height,
            });
          }}
          compact
          className="mt-2"
        />
      )}
    </section>
  );
}

function PanelHeader({
  title,
  subtitle,
  badge,
}: {
  title: string;
  subtitle: string;
  badge: string;
}) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 rounded-full bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30 flex items-center justify-center text-xs font-bold">
          {badge}
        </span>
        <div>
          <h2 className="text-sm font-semibold leading-none">{title}</h2>
          <p className="text-[11px] text-muted-foreground mt-1">{subtitle}</p>
        </div>
      </div>
    </header>
  );
}

function SourceImagePreview({
  image,
  rotation,
  boxes,
  mappedSet,
  detecting,
  onBoxClick,
  onRotate,
  onResetRotation,
  onRemove,
  onReplace,
}: {
  image: UploadedImage;
  rotation: number;
  boxes: PersonBox[];
  mappedSet: Set<number>;
  detecting: boolean;
  onBoxClick: (idx: number) => void;
  onRotate: () => void;
  onResetRotation: () => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const isAr = locale === "ar";
  // Boxes only align with the un-rotated image.
  const showBoxes = boxes.length > 0 && rotation === 0;
  return (
    <div className="studio-inset p-3 flex flex-col h-full">
      <div
        className="relative flex-1 min-h-0 rounded-md overflow-hidden bg-black/30 flex items-center justify-center cursor-pointer group"
        onClick={onReplace}
        title={t("panels.source.replace")}
      >
        <div className="relative inline-flex max-w-full max-h-full">
          <img
            src={image.url}
            alt="Source preview"
            className="max-w-full max-h-full object-contain transition-transform duration-200"
            style={{
              transform: `rotate(${rotation}deg)`,
            }}
            draggable={false}
          />
          {showBoxes &&
            boxes.map((b) => (
              <NumberedPersonBox
                key={`src-${b.index}`}
                box={b.bbox}
                number={b.index + 1}
                accent="cyan"
                mapped={mappedSet.has(b.index)}
                title={isAr ? `الشخص ${b.index + 1} — انقر للتعيين` : `Person ${b.index + 1} — click to map`}
                onClick={() => onBoxClick(b.index)}
              />
            ))}
          {detecting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-accent" />
            </div>
          )}
        </div>
        {showBoxes && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium text-cyan-300">
            <ScanFace className="h-3 w-3" />
            {isAr ? `رُصد ${boxes.length} شخص` : `${boxes.length} persons`}
          </div>
        )}
        <div className="absolute top-2 right-2 (rtl:left-2 rtl:right-auto) flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium">
          {image.width} × {image.height}
        </div>
        {/* Hover overlay - shows replace hint */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-1">
            <Replace className="h-5 w-5 text-cyan-accent" />
            <span className="text-[10px] text-cyan-accent font-medium">
              {t("panels.source.replace")}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px]">
        <Info icon={<Ruler className="h-3 w-3" />} label={t("panels.source.dimensions")} value={`${image.width}×${image.height}`} />
        <Info icon={<FileText className="h-3 w-3" />} label={t("panels.source.format")} value={(image.format || "").toUpperCase() || "—"} />
        <Info icon={<ImageIcon className="h-3 w-3" />} label={t("panels.source.fileSize")} value={formatBytes(image.size)} />
        <Info icon={<Palette className="h-3 w-3" />} label={t("common.preview")} value={image.name} />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1">
        <Button size="sm" variant="ghost" onClick={onRotate} className="h-8 text-[11px] flex flex-col gap-0.5">
          <RotateCw className="h-3.5 w-3.5" />
          <span>{t("panels.source.rotate")}</span>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-[11px] flex flex-col gap-0.5" disabled title={t("panels.source.crop")}>
          <Crop className="h-3.5 w-3.5" />
          <span>{t("panels.source.crop")}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onResetRotation} className="h-8 text-[11px] flex flex-col gap-0.5">
          <RefreshCw className="h-3.5 w-3.5" />
          <span>{t("panels.source.reset")}</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove} className="h-8 text-[11px] flex flex-col gap-0.5 text-destructive hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
          <span>{t("panels.source.remove")}</span>
        </Button>
      </div>
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="px-2 py-1.5 rounded-md bg-muted/40 flex items-center gap-1.5 min-w-0">
      <span className="text-cyan-accent/80 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] text-muted-foreground leading-none truncate">{label}</div>
        <div className="text-[10px] font-medium leading-tight truncate" title={value}>{value}</div>
      </div>
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
