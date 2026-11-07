"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Sparkles, Download, Printer, Undo2, Redo2, ZoomIn, ZoomOut, Upload, X, Loader2, Plus, Images,
} from "lucide-react";
import { useComposerStore, toUploadedImage, type ComposerBox } from "./store";

const TITLES: Record<ComposerBox, { title: string; hint: string }> = {
  source: { title: "صور المصدر", hint: "أشخاصك — يمكن رفع أكثر من صورة" },
  reference: { title: "الصور المرجعية", hint: "أشخاص آخرين — أو اذكر شخصية بالاسم في الدردشة" },
  result: { title: "النتيجة", hint: "الصورة المبنية بواسطة الوكيل" },
};

/** زوم 0..100 → مقياس 1.0 (كل الصور كاملة ظاهرة داخل المربع) .. 3.0 */
const scaleOf = (zoom: number) => 1 + (zoom / 100) * 2;

/**
 * مربع صورة الوكيل — يدعم:
 *  - تعدد الصور في المصدر/المرجع (حتى 4 صور لكل مربع، نقر = تحديد).
 *  - الأزرار السبعة تحت كل مربع: تحسين الجودة، حفظ، طباعة، تقدم، رجوع،
 *    زوم− (إلى 0 = إظهار كامل الصور دائمًا)، زوم+ (الحد الأقصى).
 */
export function ComposerImageBox({ box }: { box: ComposerBox }) {
  const isMulti = box !== "result";
  const multi = useComposerStore((s) => (isMulti ? s[box as "source" | "reference"] : null));
  const single = useComposerStore((s) => (isMulti ? null : s.result));
  const addItem = useComposerStore((s) => s.addItem);
  const removeItem = useComposerStore((s) => s.removeItem);
  const replaceItem = useComposerStore((s) => s.replaceItem);
  const selectItem = useComposerStore((s) => s.selectItem);
  const clearMultiBox = useComposerStore((s) => s.clearMultiBox);
  const multiUndo = useComposerStore((s) => s.multiUndo);
  const multiRedo = useComposerStore((s) => s.multiRedo);
  const setImage = useComposerStore((s) => s.setImage);
  const clearBox = useComposerStore((s) => s.clearBox);
  const boxUndo = useComposerStore((s) => s.boxUndo);
  const boxRedo = useComposerStore((s) => s.boxRedo);
  const setZoom = useComposerStore((s) => s.setZoom);
  const setPan = useComposerStore((s) => s.setPan);

  const [uploading, setUploading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ on: boolean; sx: number; sy: number; px: number; py: number }>({ on: false, sx: 0, sy: 0, px: 0, py: 0 });
  const printFrame = useRef<HTMLIFrameElement | null>(null);

  const { title, hint } = TITLES[box];

  // حالة موحّدة للعرض
  const st = (isMulti ? multi : single)!;
  const items = isMulti ? multi!.items : single!.img ? [single!.img!] : [];
  const zoom = st.zoom;
  const pan = st.pan;
  const selectedIdx = isMulti ? Math.min(multi!.selected, Math.max(0, items.length - 1)) : 0;
  const selectedImg = items[selectedIdx] ?? null;

  const canUndo = isMulti ? multi!.idx > 0 : single!.idx > 0;
  const canRedo = isMulti ? multi!.idx < multi!.history.length - 1 : single!.idx < single!.history.length - 1;

  const doUndo = () => (isMulti ? multiUndo(box as "source" | "reference") : boxUndo("result"));
  const doRedo = () => (isMulti ? multiRedo(box as "source" | "reference") : boxRedo("result"));
  const doClear = () => (isMulti ? clearMultiBox(box as "source" | "reference") : clearBox("result"));

  // ---------- رفع صورة (يدعم عدة ملفات دفعة واحدة) ----------
  const upload = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) {
        toast.error("اختر ملف صورة صالحًا");
        return;
      }
      setUploading(true);
      try {
        for (const file of imgs) {
          const fd = new FormData();
          fd.append("file", file);
          const r = await fetch("/api/images/upload", { method: "POST", body: fd });
          const d = await r.json();
          if (!r.ok) throw new Error(d?.error ?? "فشل الرفع");
          if (isMulti) addItem(box as "source" | "reference", d);
          else setImage("result", d, "upload");
        }
        toast.success(isMulti ? `تمت إضافة ${imgs.length > 1 ? `${imgs.length} صور` : "الصورة"} إلى ${title}` : `تم رفع ${title}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "فشل الرفع");
      } finally {
        setUploading(false);
      }
    },
    [box, isMulti, addItem, setImage, title]
  );

  // ---------- تحسين الجودة (على الصورة المحددة / صورة النتيجة) ----------
  const enhance = useCallback(async () => {
    if (!selectedImg || enhancing) return;
    setEnhancing(true);
    try {
      const r = await fetch("/api/images/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: selectedImg.path }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? d?.message ?? "فشل التحسين");
      const img = toUploadedImage(d, `enhanced-${selectedImg.name}`);
      if (isMulti) replaceItem(box as "source" | "reference", selectedIdx, img);
      else setImage("result", img, "enhance");
      toast.success("تم تحسين الجودة ✓");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تحسين الجودة");
    } finally {
      setEnhancing(false);
    }
  }, [box, isMulti, selectedImg, selectedIdx, enhancing, replaceItem, setImage]);

  // ---------- الحفظ (المتعدد: كل الصور — الفردي: الصورة) ----------
  const save = useCallback(async () => {
    if (!items.length) return;
    const list = isMulti && items.length > 1 ? items : [selectedImg ?? items[0]];
    try {
      for (const img of list) {
        if (!img) continue;
        const r = await fetch(img.url);
        const b = await r.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = img.name || "image.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        await new Promise((res) => setTimeout(res, 350));
      }
    } catch {
      toast.error("تعذر الحفظ");
    }
  }, [items, isMulti, selectedImg]);

  // ---------- الطباعة (iframe مخفي — بدون نوافذ منبثقة) ----------
  const print = useCallback(() => {
    if (!selectedImg) return;
    try {
      if (printFrame.current) printFrame.current.remove();
      const f = document.createElement("iframe");
      f.style.cssText = "position:fixed;right:-10000px;bottom:0;width:800px;height:600px;border:0;";
      document.body.appendChild(f);
      printFrame.current = f;
      const doc = f.contentWindow?.document;
      if (!doc) return;
      doc.open();
      doc.write(
        `<!doctype html><html dir="rtl"><head><title>طباعة</title></head>` +
          `<body style="margin:0;display:flex;align-items:center;justify-content:center;">` +
          `<img src="${selectedImg.url}" style="max-width:100%;max-height:96vh;object-fit:contain" ` +
          `onload="window.focus();window.print();"></body></html>`
      );
      doc.close();
      setTimeout(() => f.remove(), 60000);
    } catch {
      toast.error("تعذر بدء الطباعة");
    }
  }, [selectedImg]);

  // ---------- سحب لتحريك الصور عند الزوم ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom === 0 || !items.length) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.on) return;
    setPan(box, { x: drag.current.px + (e.clientX - drag.current.sx), y: drag.current.py + (e.clientY - drag.current.sy) });
  };
  const onPointerUp = () => (drag.current.on = false);

  useEffect(() => () => printFrame.current?.remove(), []);

  const gridCols = items.length <= 1 ? "grid-cols-1" : items.length <= 2 ? "grid-cols-2" : "grid-cols-2";
  const scale = scaleOf(zoom);
  const hasAddTile = isMulti && items.length < 4;

  return (
    <section
      className="studio-panel rounded-2xl border border-border bg-muted/20 p-3 flex flex-col gap-2 min-w-0"
      aria-label={title}
    >
      {/* رأس المربع */}
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold truncate flex items-center gap-1.5">
            {title}
            {isMulti && items.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground font-normal">
                <Images className="h-3 w-3" />
                {items.length}/4
              </span>
            )}
          </h3>
          <p className="text-[11px] text-muted-foreground truncate">{hint}</p>
        </div>
        {items.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={doClear}
            title="إزالة كل الصور"
            aria-label="إزالة كل الصور"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>

      {/* منطقة الصور — الزوم 0 = كل الصور كاملة داخل المربع دائمًا */}
      <div
        className={`relative h-60 sm:h-64 lg:h-72 rounded-xl border overflow-hidden select-none ${
          dragOver ? "border-cyan-500 ring-2 ring-cyan-500/40" : "border-border"
        } ${box === "result" ? "bg-gradient-to-br from-muted/60 to-background" : "bg-muted/40"} ${
          zoom > 0 && items.length ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) upload(files);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={() => setZoom(box, 0)}
        role="img"
        aria-label={items.length ? `${title}: ${items.length} صور` : `${title} — فارغ`}
      >
        {items.length ? (
          <div
            className={`absolute inset-0 p-1.5 ${gridCols} gap-1.5 overflow-auto`}
            style={{
              transform: `scale(${scale}) translate(${pan.x / Math.max(scale, 1)}px, ${pan.y / Math.max(scale, 1)}px)`,
              transformOrigin: "center center",
              transition: drag.current.on ? "none" : "transform 120ms ease-out",
            }}
          >
            {items.map((img, i) => (
              <div
                key={`${img.id}-${i}`}
                className={`relative min-h-0 rounded-lg border overflow-hidden bg-background/60 ${
                  isMulti && i === selectedIdx ? "border-cyan-500 ring-2 ring-cyan-500/40" : "border-border/70"
                }`}
                onClick={() => isMulti && selectItem(box as "source" | "reference", i)}
              >
                <img
                  src={img.url}
                  alt={img.name}
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-contain"
                />
                {isMulti && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(box as "source" | "reference", i);
                      }}
                      className="absolute top-1 end-1 h-5 w-5 rounded-full bg-black/65 hover:bg-red-500/85 flex items-center justify-center z-10"
                      title="إزالة هذه الصورة"
                      aria-label={`إزالة الصورة ${i + 1}`}
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                    <span className="absolute bottom-1 start-1 px-1.5 rounded bg-black/60 text-[9px] text-white/90 z-10">
                      شخص {i + 1}
                    </span>
                  </>
                )}
              </div>
            ))}
            {hasAddTile && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-cyan-500/50 transition-colors min-h-[64px]"
                aria-label="إضافة صورة أخرى"
              >
                <Plus className="h-5 w-5" />
                <span className="text-[10px]">إضافة</span>
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label={`رفع ${title}`}
          >
            {uploading ? (
              <Loader2 className="h-8 w-8 animate-spin" />
            ) : (
              <>
                <Upload className="h-8 w-8" />
                <span className="text-xs font-medium">اضغط للرفع أو أفلِت الصور هنا{isMulti ? " (حتى 4 صور)" : ""}</span>
              </>
            )}
          </button>
        )}
        {items.length > 0 && uploading && (
          <div className="absolute inset-0 grid place-items-center bg-background/60 z-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple={isMulti}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) upload(files);
            e.currentTarget.value = "";
          }}
          aria-hidden="true"
        />
      </div>

      {/* شريط الزوم — 0 = كل الصور كاملة داخل المربع (fit-to-box) */}
      <div className="flex items-center gap-2 px-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={!items.length || zoom === 0}
          onClick={() => setZoom(box, zoom - 10)}
          title="تصغير الزوم إلى 0 (إظهار كل الصورة)"
          aria-label="تصغير"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Slider
          value={[zoom]}
          min={0}
          max={100}
          step={1}
          disabled={!items.length}
          onValueChange={(v) => setZoom(box, v?.[0] ?? 0)}
          className="flex-1"
          aria-label={`زوم ${title}`}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={!items.length || zoom >= 100}
          onClick={() => setZoom(box, zoom + 10)}
          title="تكبير الزوم إلى الحد الأقصى"
          aria-label="تكبير"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] tabular-nums text-muted-foreground w-9 text-center shrink-0">
          {zoom === 0 ? "كامل" : `${zoom}%`}
        </span>
      </div>

      {/* شريط الأدوات — الأزرار السبعة تحت كل مربع */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs flex-1 min-w-[86px]"
          disabled={!selectedImg || enhancing}
          onClick={enhance}
          title="تحسين جودة الصورة المحددة"
        >
          {enhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          تحسين الجودة
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs flex-1 min-w-[64px]" disabled={!items.length} onClick={save} title="حفظ الصور">
          <Download className="h-3.5 w-3.5" />
          حفظ
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs flex-1 min-w-[64px]" disabled={!selectedImg} onClick={print} title="طباعة الصورة المحددة">
          <Printer className="h-3.5 w-3.5" />
          طباعة
        </Button>
        <div className="flex items-center gap-1.5 ms-auto">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={!canUndo}
            onClick={doUndo}
            title="الرجوع خطوة"
            aria-label="الرجوع"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={!canRedo}
            onClick={doRedo}
            title="التقدم خطوة"
            aria-label="التقدم"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </section>
  );
}
