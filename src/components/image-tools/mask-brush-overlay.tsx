"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X, Undo2, Trash2, Brush, Eraser } from "lucide-react";

/**
 * Mask-brush overlay for object removal (inpainting).
 *
 * Renders a transparent canvas exactly on top of the image. The user paints
 * the object to remove with an adjustable brush, can switch to ERASE mode to
 * undo over-selection (plus a full undo stack and clear-all), then confirms.
 *
 * The canvas BACKING STORE is the image's NATURAL resolution, so the exported
 * mask is pixel-aligned with the photo regardless of display size.
 * Zoom must be locked to 1 while this overlay is active (same rule as
 * CropOverlay) so display coordinates map 1:1 onto the image box.
 */

export interface MaskBrushOverlayProps {
  /** Natural image dimensions (pixels) */
  imageWidth: number;
  imageHeight: number;
  /** Display dimensions (the rendered <img> bounding box) */
  displayWidth: number;
  displayHeight: number;
  locale: "ar" | "en";
  /** True while the API call runs — freezes the overlay */
  busy?: boolean;
  /** Called with a PNG data URL (white strokes on transparent) at NATURAL resolution */
  onConfirm: (maskDataUrl: string) => void;
  onCancel: () => void;
}

type Mode = "add" | "erase";

export function MaskBrushOverlay({
  imageWidth,
  imageHeight,
  displayWidth,
  displayHeight,
  locale,
  busy = false,
  onConfirm,
  onCancel,
}: MaskBrushOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const modeRef = useRef<Mode>("add");

  const [mode, setMode] = useState<Mode>("add");
  const [brushSize, setBrushSize] = useState(36); // DISPLAY px diameter
  const [hasMask, setHasMask] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const t = useCallback((ar: string, en: string) => (locale === "ar" ? ar : en), [locale]);

  // display → natural scale
  const scaleX = imageWidth / displayWidth;
  const scaleY = imageHeight / displayHeight;

  useEffect(() => { modeRef.current = mode; }, [mode]);

  const getPointer = useCallback((e: PointerEvent | React.PointerEvent) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  // ===== Mask drawing primitives (all coords in DISPLAY space) =====

  const pushUndo = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    try {
      undoStackRef.current.push(ctx.getImageData(0, 0, c.width, c.height));
      if (undoStackRef.current.length > 12) undoStackRef.current.shift();
      setCanUndo(true);
    } catch { /* ignore */ }
  }, []);

  const stroke = useCallback((from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const rNat = (brushSize / 2) * scaleX; // natural-space radius
    ctx.save();
    ctx.globalCompositeOperation = modeRef.current === "add" ? "source-over" : "destination-out";
    ctx.strokeStyle = "#ffffff";
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = rNat * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // display coords → natural coords
    const nx = to.x * scaleX, ny = to.y * scaleY;
    if (from) {
      const fx = from.x * scaleX, fy = from.y * scaleY;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(nx, ny);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(nx, ny, rNat, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    setHasMask(true);
  }, [brushSize, scaleX, scaleY]);

  const undo = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const snap = undoStackRef.current.pop();
    const ctx = c.getContext("2d");
    if (!ctx) return;
    if (snap) {
      ctx.putImageData(snap, 0, 0);
    } else {
      ctx.clearRect(0, 0, c.width, c.height);
      setHasMask(false);
    }
    setCanUndo(undoStackRef.current.length > 0);
  }, []);

  const clearAll = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    pushUndo();
    const ctx = c.getContext("2d");
    ctx?.clearRect(0, 0, c.width, c.height);
    setHasMask(false);
  }, [pushUndo]);

  const exportMask = useCallback((): string | null => {
    const c = canvasRef.current;
    if (!c) return null;
    // Any white pixel at all? (cheap alpha scan at low frequency)
    try {
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let found = false;
      for (let i = 3; i < d.length; i += 16) { if (d[i] > 0) { found = true; break; } }
      if (!found) return null;
    } catch { /* tainted canvas — treat as painted */ }
    return c.toDataURL("image/png");
  }, []);

  // ===== Pointer handling =====

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    pushUndo();
    const p = getPointer(e);
    lastPtRef.current = p;
    stroke(null, p);
    drawingRef.current = true;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = getPointer(e);
    setCursorPos(p);
    if (busy || !drawingRef.current) return;
    e.preventDefault();
    stroke(lastPtRef.current, p);
    lastPtRef.current = p;
  };

  const endStroke = useCallback(() => {
    drawingRef.current = false;
    lastPtRef.current = null;
  }, []);

  useEffect(() => {
    const up = () => endStroke();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [endStroke]);

  // ===== Keyboard: Enter = confirm, Esc = cancel =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const m = exportMask();
        if (m) onConfirm(m);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exportMask, onCancel, onConfirm]);

  const handleConfirm = () => {
    const m = exportMask();
    if (m) onConfirm(m);
  };

  // Brush cursor ring follows the pointer
  const cursorStyle: React.CSSProperties | undefined = cursorPos && !busy
    ? {
        position: "absolute",
        left: cursorPos.x - brushSize / 2,
        top: cursorPos.y - brushSize / 2,
        width: brushSize,
        height: brushSize,
        borderRadius: "50%",
        border: mode === "add" ? "1.5px solid rgba(0,212,255,0.95)" : "1.5px solid rgba(255,80,80,0.95)",
        background: mode === "add" ? "rgba(0,212,255,0.18)" : "rgba(255,80,80,0.15)",
        pointerEvents: "none",
        zIndex: 22,
      }
    : undefined;

  const btn = (active: boolean): React.CSSProperties => ({
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    gap: 5,
    border: active ? "1px solid #00d4ff" : "1px solid rgba(255,255,255,0.25)",
    background: active ? "rgba(0,212,255,0.18)" : "rgba(255,255,255,0.08)",
    color: "#fff",
  });

  return (
    <div
      ref={overlayRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerLeave={() => setCursorPos(null)}
      style={{
        position: "absolute",
        inset: 0,
        cursor: busy ? "wait" : "none",
        touchAction: "none",
        zIndex: 20,
        opacity: busy ? 0.6 : 1,
      }}
    >
      {/* The mask canvas — backing store = NATURAL image resolution */}
      <canvas
        ref={canvasRef}
        width={imageWidth}
        height={imageHeight}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
      {cursorStyle && <div style={cursorStyle} />}

      {/* Hint (top-left) */}
      <div
        style={{
          position: "absolute", top: 8, left: 8, padding: "4px 8px",
          background: "rgba(0,0,0,0.7)", borderRadius: 4,
          color: "rgba(255,255,255,0.85)", fontSize: 10, zIndex: 21,
          display: "flex", alignItems: "center", gap: 4,
        }}
      >
        <Brush size={12} />
        {t("لوّن الكائن الذي تريد إزالته بالفرشاة", "Paint the object you want to remove")}
      </div>

      {/* Toolbar (top-center) */}
      <div
        style={{
          position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
          display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
          padding: "6px 10px", background: "rgba(0,0,0,0.85)",
          border: "1px solid rgba(0,212,255,0.4)", borderRadius: 8,
          color: "#fff", zIndex: 21, backdropFilter: "blur(8px)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Brush size */}
        <span style={{ fontSize: 10, opacity: 0.8 }}>{t("الفرشاة", "Brush")}</span>
        <input
          type="range"
          min={4}
          max={150}
          step={2}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          style={{ width: 110, accentColor: "#00d4ff" }}
        />
        <span style={{ fontSize: 10, fontFamily: "monospace", width: 28 }}>{brushSize}</span>
        <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.25)" }} />
        {/* Add / erase modes */}
        <button style={btn(mode === "add")} onClick={() => setMode("add")} title={t("تحديد", "Add")}>
          <Brush size={13} /> {t("تحديد", "Add")}
        </button>
        <button style={btn(mode === "erase")} onClick={() => setMode("erase")} title={t("إزالة التحديد", "Erase")}>
          <Eraser size={13} /> {t("إزالة تحديد", "Erase")}
        </button>
        <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.25)" }} />
        <button style={btn(false)} onClick={undo} disabled={!canUndo || busy} title={t("تراجع", "Undo")}>
          <Undo2 size={13} /> {t("تراجع", "Undo")}
        </button>
        <button style={btn(false)} onClick={clearAll} disabled={busy} title={t("مسح الكل", "Clear all")}>
          <Trash2 size={13} /> {t("مسح الكل", "Clear")}
        </button>
      </div>

      {/* Actions (bottom-center) */}
      <div
        style={{
          position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
          display: "flex", gap: 8, zIndex: 21,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleConfirm}
          disabled={busy || !hasMask}
          style={{
            padding: "8px 16px", background: hasMask && !busy ? "#00d4ff" : "rgba(0,212,255,0.35)",
            color: "#000", border: "none", borderRadius: 6, cursor: hasMask && !busy ? "pointer" : "not-allowed",
            fontWeight: "bold", display: "flex", alignItems: "center", gap: 6, fontSize: 12,
          }}
        >
          <Check size={16} />
          {t("إزالة المحدد", "Remove selection")}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          style={{
            padding: "8px 16px", background: "rgba(255,255,255,0.1)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.3)", borderRadius: 6, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 6, fontSize: 12,
          }}
        >
          <X size={16} />
          {t("إلغاء", "Cancel")}
        </button>
      </div>

      {/* Busy note */}
      {busy && (
        <div
          style={{
            position: "absolute", bottom: 52, left: "50%", transform: "translateX(-50%)",
            padding: "6px 14px", background: "rgba(0,0,0,0.8)", borderRadius: 6,
            color: "#00d4ff", fontSize: 11, zIndex: 21, fontFamily: "monospace",
          }}
        >
          {t("جارٍ إزالة الكائن وترميم الخلفية…", "Removing object and repairing background…")}
        </div>
      )}
    </div>
  );
}
