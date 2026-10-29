"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useImageStore, type UploadedImage } from "@/stores/image-store";
import { ImageDropZone } from "./image-dropzone";
import { EnhanceQualityButtons, type EnhancedResult } from "@/components/shared/enhance-quality-buttons";
import { Button } from "@/components/ui/button";
import { Trash2, Shirt, Replace, Image as ImageIcon, Type, Mic, Square, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, ScanFace } from "lucide-react";
import { useGarmentMappingStore, type PersonBox } from "@/stores/garment-mapping-store";
import { usePersonAutoDetect } from "@/hooks/use-person-detect";
import { NumberedPersonBox } from "@/components/shared/numbered-person-box";

type Mode = "image" | "description";

export function GarmentPanel() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const isAr = locale === "ar";
  const garment = useImageStore((s) => s.garment);
  const garmentList = useImageStore((s) => s.garmentList);
  const setGarment = useImageStore((s) => s.setGarment);
  const setGarmentList = useImageStore((s) => s.setGarmentList);
  const pushStudioHistory = useImageStore((s) => s.pushStudioHistory);
  const [mode, setMode] = useState<Mode>("image");
  const { toast } = useToast();
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const [addingCount, setAddingCount] = useState(0);

  // Multi-reference active index (shared with the mapping store).
  const activeRefImage = useGarmentMappingStore((s) => s.activeRefImage);
  const setActiveRefImage = useGarmentMappingStore((s) => s.setActiveRefImage);
  const fixAfterRefRemove = useGarmentMappingStore((s) => s.fixAfterRefRemove);

  // The ACTIVE reference image (preview + legacy consumers).
  const activeImage = garmentList[activeRefImage] ?? garment ?? null;

  // Numbered-box garment swap: auto-detect reference persons/outfits on
  // the ACTIVE garment image and keep the shared mapping store in sync.
  usePersonAutoDetect("ref", activeImage, activeRefImage);

  // Keep `garment` (active mirror) in sync when the active index changes.
  useEffect(() => {
    const g = garmentList[activeRefImage] ?? null;
    if (g && garment && g.path !== garment.path) setGarment(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRefImage, garmentList]);

  // Numbered boxes on the active reference image.
  const refBoxes = useGarmentMappingStore((s) => s.refBoxes);
  const detectingRef = useGarmentMappingStore((s) => s.detecting.ref);
  const mappings = useGarmentMappingStore((s) => s.mappings);
  const setInActiveRow = useGarmentMappingStore((s) => s.setInActiveRow);
  const mappedRefSet = new Set(
    mappings.filter((m) => (m.refImage ?? 0) === activeRefImage).map((m) => m.refIndex)
  );

  const uploadOne = async (file: File): Promise<UploadedImage | null> => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/images/upload", { method: "POST", body: fd });
      const data = await r.json();
      if (data.url) return data as UploadedImage;
      toast({ title: t(data.error ?? "errors.invalidImage"), variant: "destructive" });
      return null;
    } catch {
      toast({ title: t("errors.unknown"), variant: "destructive" });
      return null;
    }
  };

  /** First upload (drop zone) → start the list. */
  const handleFirstUpload = (img: UploadedImage) => {
    pushStudioHistory(`Garment: ${img.name ?? "image"}`);
    setGarmentList([img], 0);
    toast({ title: t("success.imageUploaded") });
  };

  /** Replace the ACTIVE reference image (same slot). */
  const handleReplace = async (file: File) => {
    const img = await uploadOne(file);
    if (!img) return;
    pushStudioHistory(`Garment replaced: ${img.name ?? "image"}`);
    const next = garmentList.map((g, gi) => (gi === activeRefImage ? img : g));
    setGarmentList(next, activeRefImage);
    toast({ title: t("success.imageUploaded") });
  };

  /** Add one or MORE reference images (multi-reference feature). */
  const handleAddFiles = async (files: FileList) => {
    setAddingCount(files.length);
    const added: UploadedImage[] = [];
    for (const f of Array.from(files)) {
      const img = await uploadOne(f);
      if (img) added.push(img);
    }
    setAddingCount(0);
    if (!added.length) return;
    pushStudioHistory(`Garments added: +${added.length}`);
    const next = [...garmentList, ...added].slice(0, 6);
    // Jump to the first newly added image so the user sees its boxes.
    setGarmentList(next, garmentList.length);
    toast({
      title: isAr ? `تمت إضافة ${added.length} صورة مرجعية` : `Added ${added.length} reference image(s)`,
    });
  };

  /** Remove reference image i (fix mappings that pointed at it). */
  const handleRemoveAt = (i: number) => {
    pushStudioHistory("Garment: removed");
    const next = garmentList.filter((_, di) => di !== i);
    fixAfterRefRemove(i);
    setGarmentList(next, Math.max(0, Math.min(i, next.length - 1)));
  };

  return (
    <section className="studio-panel p-4 flex flex-col h-full">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-6 w-6 rounded-full bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30 flex items-center justify-center text-xs font-bold">
            2
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-none">{t("panels.garment.title")}</h2>
            <p className="text-[11px] text-muted-foreground mt-1">{t("panels.garment.subtitle")}</p>
          </div>
        </div>
        {garmentList.length > 1 && (
          <Badge variant="outline" className="text-[10px] h-5 gap-1 border-fuchsia-400/40 text-fuchsia-300">
            <Shirt className="h-3 w-3" />
            {isAr ? `${garmentList.length} مراجع` : `${garmentList.length} refs`}
          </Badge>
        )}
      </header>

      <input
        ref={replaceInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.tiff,image/jpeg,image/png,image/webp,image/tiff"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleReplace(f);
          e.target.value = "";
        }}
      />
      <input
        ref={addInputRef}
        type="file"
        multiple
        accept=".jpg,.jpeg,.png,.webp,.tiff,image/jpeg,image/png,image/webp,image/tiff"
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) void handleAddFiles(files);
          e.target.value = "";
        }}
      />

      {/* Mode switcher */}
      <div className="mt-2 flex items-center gap-1 p-0.5 rounded-md bg-muted/40">
        <ModeButton
          active={mode === "image"}
          onClick={() => setMode("image")}
          icon={<ImageIcon className="h-3 w-3" />}
          label={t("panels.garment.modeImage")}
        />
        <ModeButton
          active={mode === "description"}
          onClick={() => setMode("description")}
          icon={<Type className="h-3 w-3" />}
          label={t("panels.garment.modeDescription")}
        />
      </div>

      <div className="flex-1 mt-3 min-h-0 flex flex-col gap-2">
        {mode === "image" ? (
          !activeImage ? (
            <ImageDropZone
              variant="garment"
              onUploaded={handleFirstUpload}
            />
          ) : (
            <>
              <GarmentPreview
                image={activeImage}
                imageNo={activeRefImage + 1}
                totalImages={garmentList.length}
                boxes={refBoxes}
                mappedSet={mappedRefSet}
                detecting={detectingRef || addingCount > 0}
                onBoxClick={(idx: number) => setInActiveRow("ref", idx)}
                onRemove={() => handleRemoveAt(activeRefImage)}
                onReplace={() => replaceInputRef.current?.click()}
              />
              {/* ===== Multi-reference thumbnail strip ===== */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0">
                {garmentList.map((g, i) => (
                  <div
                    key={`${g.path}-${i}`}
                    className={cn(
                      "relative h-14 w-14 shrink-0 rounded-md overflow-hidden ring-2 cursor-pointer transition-all",
                      i === activeRefImage
                        ? "ring-fuchsia-400 opacity-100"
                        : "ring-transparent opacity-60 hover:opacity-100"
                    )}
                    onClick={() => setActiveRefImage(i)}
                    title={isAr ? `مرجع ${i + 1}` : `Reference ${i + 1}`}
                  >
                    <img src={g.url} alt={`ref-${i + 1}`} className="h-full w-full object-cover" draggable={false} />
                    <span className="absolute top-0 start-0 bg-fuchsia-500 text-white text-[9px] font-bold px-1 rounded-br-md">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveAt(i);
                      }}
                      className="absolute top-0 end-0 h-4 w-4 bg-black/70 text-white flex items-center justify-center hover:bg-red-500"
                      title={isAr ? "حذف" : "Remove"}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {garmentList.length > 0 && garmentList.length < 6 && (
                  <button
                    type="button"
                    onClick={() => addInputRef.current?.click()}
                    className="h-14 w-14 shrink-0 rounded-md border border-dashed border-fuchsia-400/50 text-fuchsia-300 flex flex-col items-center justify-center gap-0.5 hover:bg-fuchsia-500/10 transition-colors"
                    title={isAr ? "إضافة صورة مرجعية أخرى" : "Add another reference image"}
                  >
                    {addingCount > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    <span className="text-[8px] leading-none">{isAr ? "إضافة" : "Add"}</span>
                  </button>
                )}
              </div>
              {garmentList.length > 1 && (
                <p className="text-[10px] text-muted-foreground leading-relaxed shrink-0">
                  {isAr
                    ? "يمكنك إضافة عدة صور مرجعية وربط كل شخص في المصدر بمرجع مختلف — انقر صورة مصغّرة لعرض مربعاتها المرقمة."
                    : "Add several reference images and map each source person to a different one — click a thumbnail to show its numbered boxes."}
                </p>
              )}
            </>
          )
        ) : (
          <GarmentDescription />
        )}
      </div>
      {/* 5-level Enhance Quality buttons — same pipeline as Image Tools */}
      {mode === "image" && activeImage && (
        <EnhanceQualityButtons
          sourcePath={activeImage.path}
          onEnhanced={(result: EnhancedResult) => {
            pushStudioHistory(`Garment enhanced: ${result.qualityLabel}`);
            const next = garmentList.map((g, gi) =>
              gi === activeRefImage
                ? { ...g, url: result.url, path: result.path, width: result.width, height: result.height, size: result.size }
                : g
            );
            setGarmentList(next, activeRefImage);
          }}
          variant="compact"
          className="mt-2"
        />
      )}
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1.5 h-7 px-2 rounded text-[11px] font-medium transition-colors",
        active
          ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function GarmentPreview({
  image,
  imageNo,
  totalImages,
  boxes,
  mappedSet,
  detecting,
  onBoxClick,
  onRemove,
  onReplace,
}: {
  image: UploadedImage;
  imageNo: number;
  totalImages: number;
  boxes: PersonBox[];
  mappedSet: Set<number>;
  detecting: boolean;
  onBoxClick: (idx: number) => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const isAr = locale === "ar";
  return (
    <div className="studio-inset p-3 flex flex-col h-full min-h-0">
      <div
        className="relative flex-1 min-h-0 rounded-md overflow-hidden bg-black/30 flex items-center justify-center cursor-pointer group"
        onClick={onReplace}
        title={t("panels.source.replace")}
      >
        <div className="relative inline-flex max-w-full max-h-full">
          <img
            src={image.url}
            alt="Garment preview"
            className="max-w-full max-h-full object-contain"
            draggable={false}
          />
          {boxes.length > 0 &&
            boxes.map((b) => (
              <NumberedPersonBox
                key={`ref-${b.index}`}
                box={b.bbox}
                number={b.index + 1}
                accent="fuchsia"
                mapped={mappedSet.has(b.index)}
                title={isAr ? `الملابس ${b.index + 1} — انقر للتعيين` : `Outfit ${b.index + 1} — click to map`}
                onClick={() => onBoxClick(b.index)}
              />
            ))}
          {detecting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-accent" />
            </div>
          )}
        </div>
        {boxes.length > 0 && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium text-fuchsia-300">
            <ScanFace className="h-3 w-3" />
            {totalImages > 1
              ? isAr
                ? `مرجع ${imageNo}: رُصدت ${boxes.length} ملابس`
                : `Ref ${imageNo}: ${boxes.length} outfits`
              : isAr
                ? `رُصدت ${boxes.length} ملابس`
                : `${boxes.length} outfits`}
          </div>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-1">
            <Replace className="h-5 w-5 text-cyan-accent" />
            <span className="text-[10px] text-cyan-accent font-medium">
              {t("panels.source.replace")}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary" className="text-[10px] h-5 gap-1">
          <Shirt className="h-3 w-3" />
          {image.detectedGarmentType
            ? t(`panels.garment.${image.detectedGarmentType}`)
            : t("panels.garment.title")}
        </Badge>
        {image.detectedColor && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-[10px]">
            <span
              className="h-2.5 w-2.5 rounded-full ring-1 ring-border"
              style={{ backgroundColor: image.detectedColor }}
            />
            {image.detectedColor}
          </div>
        )}
        <Badge variant="outline" className="text-[10px] h-5">
          {(image.format || "").toUpperCase() || "—"}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1">
        <Button size="sm" variant="ghost" onClick={onReplace} className="h-8 text-[11px]">
          <Replace className="h-3.5 w-3.5" />
          {t("panels.source.replace")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove} className="h-8 text-[11px] text-destructive hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
          {t("panels.source.remove")}
        </Button>
      </div>
    </div>
  );
}

// Web Speech API type shim
type SpeechRecognitionInstance = {
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: Array<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
};

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function GarmentDescription() {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const text = useImageStore((s) => s.garmentDescription);
  const setText = useImageStore((s) => s.setGarmentDescription);
  const pushStudioHistory = useImageStore((s) => s.pushStudioHistory);
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const startRecording = () => {
    const SR = getSpeechRecognition();
    if (!SR) {
      setSupported(false);
      toast({
        title: t("panels.garment.voiceNotSupported"),
        description: t("panels.garment.voiceNotSupportedDesc"),
        variant: "destructive",
      });
      return;
    }
    const rec = new SR();
    rec.lang = locale === "ar" ? "ar-SA" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event) => {
      let final = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) final += r[0].transcript;
      }
      if (final.trim()) {
        const current = useImageStore.getState().garmentDescription;
        const next = (current ? current + " " : "") + final.trim();
        pushStudioHistory(`Garment desc: ${final.slice(0, 40)}`);
        setText(next);
      }
    };
    rec.onend = () => {
      setRecording(false);
    };
    rec.onerror = (event) => {
      setRecording(false);
      toast({
        title: t("panels.garment.voiceError"),
        description: event.error,
        variant: "destructive",
      });
    };
    recognitionRef.current = rec;
    rec.start();
    setRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setRecording(false);
  };

  return (
    <div className="studio-inset p-3 flex flex-col h-full gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {t("panels.garment.descriptionHint")}
        </span>
        <Badge variant="outline" className="text-[9px] h-4 gap-1">
          <Mic className="h-2.5 w-2.5" />
          {locale === "ar" ? "ar-SA" : "en-US"}
        </Badge>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("panels.garment.descriptionPlaceholder")}
        className="flex-1 min-h-[120px] resize-none rounded-md bg-background/50 border border-panel-border p-3 text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-cyan-accent focus:border-cyan-accent/50 placeholder:text-muted-foreground/60"
        dir={locale === "ar" ? "rtl" : "ltr"}
      />

      <div className="flex items-center gap-1.5">
        <Button
          variant={recording ? "destructive" : "outline"}
          size="sm"
          onClick={recording ? stopRecording : startRecording}
          disabled={!supported}
          className="h-8 text-[11px] gap-1.5"
        >
          {recording ? (
            <>
              <Square className="h-3 w-3 animate-pulse" />
              {t("panels.garment.stopRecording")}
            </>
          ) : (
            <>
              <Mic className="h-3 w-3" />
              {t("panels.garment.startRecording")}
            </>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            pushStudioHistory("Garment desc: cleared");
            setText("");
          }}
          disabled={!text}
          className="h-8 text-[11px]"
        >
          {t("common.reset")}
        </Button>
      </div>

      {recording && (
        <div className="flex items-center gap-2 text-[10px] text-cyan-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-accent cyan-pulse" />
          {t("panels.garment.recording")}
          <span className="text-muted-foreground">— {t("panels.garment.recordingHint")}</span>
        </div>
      )}

      {text && (
        <div className="text-[10px] text-muted-foreground px-2 py-1 rounded bg-muted/30">
          {text.split(/\s+/).filter(Boolean).length} {t("panels.garment.words")}
        </div>
      )}
    </div>
  );
}
