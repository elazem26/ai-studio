"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  Sparkles, Download, Printer, Undo2, Redo2, ZoomIn, ZoomOut, Upload, X, Loader2,
} from "lucide-react";
import { useComposerStore, toUploadedImage, type ComposerBox, type BoxState } from "./store";

const TITLES: Record<ComposerBox, { title: string; hint: string }> = {
  source: { title: "صورة المصدر", hint: "الشخص الأول (مثال: رجل)" },
  reference: { title: "صورة المرجع", hint: "الشخص الثاني (مثال: امرأة)" },
  result: { title: "النتيجة", hint: "الصورة المبنية بواسطة الوكيل" },
};

/** زوم 0..100 → مقياس 1.0 (الصورة كاملة ظاهرة) .. 3.0 */
const scaleOf = (zoom: number) => 1 + (zoom / 100) * 2;

export function ComposerImageBox({ box }: { box: ComposerBox }) {
  const st: BoxState = useComposerStore((s) => s[box]);
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

  // ---------- رفع صورة ----------
  const upload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("اختر ملف صورة صالحًا");
        return;
      }
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/images/upload", { method: "POST", body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? "فشل الرفع");
        setImage(box, d as any, "upload");
        toast.success(box === "result" ? "تم تعيين النتيجة" : `تم رفع ${TITLES[box].title}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "فشل الرفع");
      } finally {
        setUploading(false);
      }
    },
    [box, setImage]
  );

  // ---------- تحسين الجودة ----------
  const enhance = useCallback(async () => {
    if (!st.img || enhancing) return;
    setEnhancing(true);
    try {
      const r = await fetch("/api/images/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: st.img.path }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? d?.message ?? "فشل التحسين");
      setImage(box, toUploadedImage(d, `enhanced-${st.img.name}`), "enhance");
      toast.success("تم تحسين الجودة ✓");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تحسين الجودة");
    } finally {
      setEnhancing(false);
    }
  }, [box, st.img, enhancing, setImage]);

  // ---------- الحفظ ----------
  const save = useCallback(async () => {
    if (!st.img) return;
    try {
      const r = await fetch(st.img.url);
      const b = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = st.img.name || "image.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      toast.error("تعذر الحفظ");
    }
  }, [st.img]);

  // ---------- الطباعة (iframe مخفي — بدون نوافذ منبثقة) ----------
  const print = useCallback(() => {
    if (!st.img) return;
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
          `<img src="${st.img.url}" style="max-width:100%;max-height:96vh;object-fit:contain" ` +
          `onload="window.focus();window.print();"></body></html>`
      );
      doc.close();
      setTimeout(() => f.remove(), 60000);
    } catch {
      toast.error("تعذر بدء الطباعة");
    }
  }, [st.img]);

  // ---------- سحب لتحريك الصورة عند الزوم ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (st.zoom === 0 || !st.img) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, px: st.pan.x, py: st.pan.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.on) return;
    setPan(box, { x: drag.current.px + (e.clientX - drag.current.sx), y: drag.current.py + (e.clientY - drag.current.sy) });
  };
  const onPointerUp = () => (drag.current.on = false);

  const canUndo = st.idx > 0;
  const canRedo = st.idx < st.history.length - 1;

  useEffect(() => () => printFrame.current?.remove(), []);

  return (
    <section
      className="studio-panel rounded-2xl border border-border bg-muted/20 p-3 flex flex-col gap-2 min-w-0"
      aria-label={title}
    >
      {/* رأس المربع */}
      <header className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold truncate">{title}</h3>
          <p className="text-[11px] text-muted-foreground truncate">{hint}</p>
        </div>
        {st.img && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => clearBox(box)}
            title="إزالة الصورة"
            aria-label="إزالة الصورة"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>

      {/* منطقة الصورة */}
      <div
        className={`relative h-60 sm:h-64 lg:h-72 rounded-xl border overflow-hidden select-none ${
          dragOver ? "border-cyan-500 ring-2 ring-cyan-500/40" : "border-border"
        } ${box === "result" ? "bg-gradient-to-br from-muted/60 to-background" : "bg-muted/40"} ${
          st.zoom > 0 && st.img ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={() => setZoom(box, 0)}
        role="img"
        aria-label={st.img ? `${title}: ${st.img.name}` : `${title} — فارغ`}
      >
        {st.img ? (
          <img
            src={st.img.url}
            alt={st.img.name}
            draggable={false}
            className="absolute inset-0 w-full h-full object-contain"
            style={{
              transform: `scale(${scaleOf(st.zoom)}) translate(${st.pan.x / Math.max(scaleOf(st.zoom), 1)}px, ${st.pan.y / Math.max(scaleOf(st.zoom), 1)}px)`,
              transition: drag.current.on ? "none" : "transform 120ms ease-out",
            }}
          />
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
                <span className="text-xs font-medium">اضغط للرفع أو أفلِت الصورة هنا</span>
              </>
            )}
          </button>
        )}
        {st.img && uploading && (
          <div className="absolute inset-0 grid place-items-center bg-background/60">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.currentTarget.value = "";
          }}
          aria-hidden="true"
        />
      </div>

      {/* شريط الزوم — 0 = الصورة كاملة داخل المربع */}
      <div className="flex items-center gap-2 px-1">
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={!st.img || st.zoom === 0}
          onClick={() => setZoom(box, st.zoom - 10)}
          title="تصغير (0 = الصورة كاملة)"
          aria-label="تصغير"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Slider
          value={[st.zoom]}
          min={0}
          max={100}
          step={1}
          disabled={!st.img}
          onValueChange={(v) => setZoom(box, v?.[0] ?? 0)}
          className="flex-1"
          aria-label={`زوم ${title}`}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          disabled={!st.img || st.zoom >= 100}
          onClick={() => setZoom(box, st.zoom + 10)}
          title="تكبير للحد الأقصى"
          aria-label="تكبير"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[10px] tabular-nums text-muted-foreground w-9 text-center shrink-0">
          {st.zoom === 0 ? "كامل" : `${st.zoom}%`}
        </span>
      </div>

      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 text-xs flex-1 min-w-[86px]"
          disabled={!st.img || enhancing}
          onClick={enhance}
          title="تحسين جودة الصورة"
        >
          {enhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          تحسين الجودة
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs flex-1 min-w-[70px]" disabled={!st.img} onClick={save} title="حفظ الصورة">
          <Download className="h-3.5 w-3.5" />
          حفظ
        </Button>
        <Button size="sm" variant="outline" className="h-8 text-xs flex-1 min-w-[70px]" disabled={!st.img} onClick={print} title="طباعة الصورة">
          <Printer className="h-3.5 w-3.5" />
          طباعة
        </Button>
        <div className="flex items-center gap-1.5 ms-auto">
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={!canUndo}
            onClick={() => boxUndo(box)}
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
            onClick={() => boxRedo(box)}
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
