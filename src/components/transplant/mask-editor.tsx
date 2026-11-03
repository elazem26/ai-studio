"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Eraser, Plus, Undo2, RotateCcw, X, Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * MaskEditor — محرر التحديد بالماوس.
 *
 * يعرض صورة المرجع مع التحديد الأخضر (من الخادم) ويسمح بتعديله مباشرة:
 *  - الضغط/السحب داخل المنطقة الخضراء → إزالة من التحديد
 *  - الضغط/السحب خارجها → إضافة إلى التحديد
 *  (الوضع الذكي) أو بأداة صريحة: إضافة / إزالة.
 *
 * القناع الناتج يُصدَّر كـ PNG رمادي (أبيض = محدد) ويُرسل إلى الخادم
 * عند «نقل الآن» — فالنقل ينفذ بالضبط ما يراه المستخدم.
 */

type Tool = "smart" | "add" | "remove";

const GREEN = "rgba(60, 220, 110, 0.45)";

export function MaskEditor({
  imageSrc,
  maskSrc,
  onChange,
  onCancel,
  label,
}: {
  /** الصورة الأصلية (data URL) — تحدد أبعاد لوح العمل */
  imageSrc: string;
  /** القناع الرمادي المبدئي من الخادم (يُقرأ مرة واحدة عند التركيب) */
  maskSrc: string;
  /** يُستدعى بعد كل تعديل بالقناع الجديد (data URL) */
  onChange: (maskDataUrl: string) => void;
  onCancel?: () => void;
  label?: string;
}) {
  const imgEl = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);   // قناع العمل (رمادي)
  const tintRef = useRef<HTMLCanvasElement | null>(null);   // التظليل الأخضر المحسوب
  const undoStack = useRef<ImageData[]>([]);
  const painting = useRef(false);
  const erasing = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);

  const initImage = useRef(imageSrc);
  const initMask = useRef(maskSrc);

  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("smart");
  const [brush, setBrush] = useState(6);   // % من أصغر بُعد
  const [edits, setEdits] = useState(0);

  /** بناء طبقة التظليل الأخضر من قناع العمل (تمرير واحد على البكسلات) */
  const rebuildTint = useCallback(() => {
    const mc = maskRef.current;
    if (!mc) return;
    let t = tintRef.current;
    if (!t) {
      t = document.createElement("canvas");
      t.width = mc.width;
      t.height = mc.height;
      tintRef.current = t;
    }
    const tc = t.getContext("2d");
    const mx = mc.getContext("2d");
    if (!tc || !mx) return;
    const data = mx.getImageData(0, 0, mc.width, mc.height);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i]; // القناع رمادي: r=g=b
      d[i] = 60; d[i + 1] = 220; d[i + 2] = 110;
      d[i + 3] = (v * 0.55) | 0;
    }
    tc.clearRect(0, 0, t.width, t.height);
    tc.putImageData(data, 0, 0);
  }, []);

  const render = useCallback(() => {
    const c = viewRef.current;
    const t = tintRef.current;
    if (!c || !t) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(t, 0, 0, c.width, c.height);
  }, []);

  const emit = useCallback(() => {
    const mc = maskRef.current;
    if (!mc) return;
    onChange(mc.toDataURL("image/png"));
  }, [onChange]);

  /* ---------------- التهيئة (مرة واحدة) ---------------- */
  useEffect(() => {
    let alive = true;
    setReady(false);
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      imgEl.current = img;
      const natW = img.naturalWidth || 800;
      const natH = img.naturalHeight || 1000;
      // سقف للحجم: أداء سلس على الصور الضخمة
      const scale = Math.min(1, 2000 / Math.max(natW, natH));
      const W = Math.max(1, Math.round(natW * scale));
      const H = Math.max(1, Math.round(natH * scale));

      const mc = document.createElement("canvas");
      mc.width = W; mc.height = H;
      const mx = mc.getContext("2d");
      if (!mx) return;
      mx.fillStyle = "#000";
      mx.fillRect(0, 0, W, H);

      const mimg = new Image();
      mimg.onload = () => {
        if (!alive) return;
        mx.drawImage(mimg, 0, 0, W, H);   // قناع الخادم بأبعاد الصورة
        maskRef.current = mc;
        tintRef.current = null;
        undoStack.current = [];
        setEdits(0);
        const c = viewRef.current;
        if (c) { c.width = W; c.height = H; }
        rebuildTint();
        render();
        setReady(true);
      };
      mimg.onerror = () => {
        // قناع غير صالح → تحديد فارغ
        maskRef.current = mc;
        const c = viewRef.current;
        if (c) { c.width = W; c.height = H; }
        rebuildTint();
        render();
        setReady(true);
      };
      mimg.src = initMask.current;
    };
    img.src = initImage.current;
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- الرسم ---------------- */
  const brushPx = () => {
    const mc = maskRef.current;
    if (!mc) return 24;
    return Math.max(6, Math.round((brush / 100) * Math.min(mc.width, mc.height)));
  };

  const toCanvasPt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = viewRef.current!;
    const rect = c.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * c.width;
    const y = ((e.clientY - rect.top) / rect.height) * c.height;
    return { x, y };
  };

  const maskValueAt = (x: number, y: number): number => {
    const mc = maskRef.current;
    if (!mc) return 0;
    const mx = mc.getContext("2d");
    if (!mx) return 0;
    const d = mx.getImageData(Math.max(0, Math.min(mc.width - 1, x | 0)),
                              Math.max(0, Math.min(mc.height - 1, y | 0)), 1, 1).data;
    return d[0];
  };

  const paintStamp = (x: number, y: number, erase: boolean) => {
    const mc = maskRef.current;
    if (!mc) return;
    const mx = mc.getContext("2d");
    if (!mx) return;
    const r = brushPx();
    mx.globalCompositeOperation = "source-over";
    mx.fillStyle = erase ? "#000" : "#fff";
    mx.beginPath();
    mx.arc(x, y, r, 0, Math.PI * 2);
    mx.fill();
  };

  const paintSegment = (x1: number, y1: number, x2: number, y2: number, erase: boolean) => {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const step = Math.max(2, brushPx() * 0.35);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= n; i++) {
      paintStamp(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, erase);
    }
  };

  /** معاينة فورية للفرشاة على الشاشة (بدون إعادة بناء التظليل) */
  const previewStamp = (x: number, y: number, erase: boolean) => {
    const c = viewRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const r = brushPx();
    ctx.save();
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.fillStyle = erase ? "rgba(0,0,0,1)" : GREEN;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPt(e);
    const v = maskValueAt(p.x, p.y);
    erasing.current = tool === "remove" || (tool === "smart" && v > 127);
    painting.current = true;
    lastPt.current = p;
    const mc = maskRef.current;
    if (mc) {
      const mx = mc.getContext("2d");
      if (mx) {
        undoStack.current.push(mx.getImageData(0, 0, mc.width, mc.height));
        if (undoStack.current.length > 12) undoStack.current.shift();
      }
    }
    paintStamp(p.x, p.y, erasing.current);
    previewStamp(p.x, p.y, erasing.current);
    setEdits(n => n + 1);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting.current || !ready) return;
    const p = toCanvasPt(e);
    const l = lastPt.current || p;
    paintSegment(l.x, l.y, p.x, p.y, erasing.current);
    previewStamp(p.x, p.y, erasing.current);
    lastPt.current = p;
  };

  const finishStroke = () => {
    if (!painting.current) return;
    painting.current = false;
    lastPt.current = null;
    rebuildTint();
    render();
    emit();
  };

  const undo = () => {
    const mc = maskRef.current;
    const snap = undoStack.current.pop();
    if (!mc || !snap) return;
    const mx = mc.getContext("2d");
    if (!mx) return;
    mx.putImageData(snap, 0, 0);
    rebuildTint();
    render();
    emit();
  };

  const reset = () => {
    const mc = maskRef.current;
    if (!mc) return;
    const mx = mc.getContext("2d");
    if (!mx) return;
    mx.fillStyle = "#000";
    mx.fillRect(0, 0, mc.width, mc.height);
    const mimg = new Image();
    mimg.onload = () => {
      mx.drawImage(mimg, 0, 0, mc.width, mc.height);
      undoStack.current = [];
      rebuildTint();
      render();
      emit();
    };
    mimg.src = initMask.current;
  };

  const clearAll = () => {
    const mc = maskRef.current;
    if (!mc) return;
    const mx = mc.getContext("2d");
    if (!mx) return;
    const snap = mx.getImageData(0, 0, mc.width, mc.height);
    undoStack.current.push(snap);
    mx.fillStyle = "#000";
    mx.fillRect(0, 0, mc.width, mc.height);
    rebuildTint();
    render();
    emit();
  };

  const toolBtn = (key: Tool, icon: React.ReactNode, text: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setTool(key)}
      className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors ${
        tool === key
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/50"
      }`}
    >
      {icon}
      {text}
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-fuchsia-500" />
          <span className="text-sm font-semibold">صورة المرجع{label ? ` — ${label}` : ""}</span>
          {edits > 0 && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
              معدّل بالماوس
            </span>
          )}
        </div>
        {onCancel && (
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancel} title="إلغاء التحديد">
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="relative overflow-hidden rounded-lg border-2 border-emerald-500/40 bg-neutral-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={initImage.current} alt="المرجع" className="block w-full select-none" draggable={false} />
        <canvas
          ref={viewRef}
          className={`absolute inset-0 h-full w-full ${ready ? (painting.current ? "" : "cursor-crosshair") : "opacity-0"}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishStroke}
          onPointerLeave={finishStroke}
          onPointerCancel={finishStroke}
        />
        {!ready && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            جارٍ تجهيز المحرر…
          </span>
        )}
      </div>

      {/* شريط أدوات المحرر */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5">
        {toolBtn("smart", <Wand2 className="h-3.5 w-3.5" />, "ذكي")}
        {toolBtn("add", <Plus className="h-3.5 w-3.5" />, "إضافة")}
        {toolBtn("remove", <Eraser className="h-3.5 w-3.5" />, "إزالة")}
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          الفرشاة
          <input
            type="range" min={2} max={18} step={1} value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
            className="w-20 accent-emerald-500"
          />
        </label>
        <span className="flex-1" />
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={undo} disabled={edits === 0}>
          <Undo2 className="h-3.5 w-3.5" />
          <span className="text-[11px] ms-1">تراجع</span>
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="text-[11px] ms-1">إعادة ضبط</span>
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={clearAll}>
          <Eraser className="h-3.5 w-3.5" />
          <span className="text-[11px] ms-1">مسح الكل</span>
        </Button>
      </div>
      <p className="text-[10px] leading-4 text-muted-foreground">
        اضغط أو اسحب على الصورة لتعديل التحديد: في الوضع «ذكي» الضغط داخل الأخضر يزيل وخارجه يضيف — أو اختر «إضافة»/«إزالة» بنفسك. التعديل يُنفَّذ كما تراه عند «نقل الآن».
      </p>
    </div>
  );
}
