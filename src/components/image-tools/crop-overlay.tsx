"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, X, Move } from "lucide-react";

/**
 * Interactive crop overlay.
 *
 * Renders on top of an image element. The user can:
 *   1. Draw a new selection by clicking-and-dragging on the image
 *   2. Move the existing selection by dragging inside it
 *   3. Resize the selection via 8 corner/edge handles
 *   4. Click "موافق/OK" to crop, or "إلغاء/Cancel" to abort
 *
 * All coordinates are in DISPLAY space (relative to the image element).
 * The parent component is responsible for converting display → image space
 * when calling the actual crop API (using image natural dimensions).
 */

export interface CropRect {
  x: number; // display px
  y: number; // display px
  width: number; // display px
  height: number; // display px
}

export interface CropOverlayProps {
  /** Natural image dimensions (pixels) */
  imageWidth: number;
  imageHeight: number;
  /** Display dimensions (the rendered <img> bounding box) */
  displayWidth: number;
  displayHeight: number;
  locale: "ar" | "en";
  onConfirm: (rect: CropRect) => void;
  onCancel: () => void;
}

type DragMode =
  | { type: "none" }
  | { type: "new"; startX: number; startY: number }
  | { type: "move"; offsetX: number; offsetY: number }
  | { type: "resize"; handle: HandlePosition };

type HandlePosition = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const HANDLES: HandlePosition[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const MIN_SIZE = 20; // minimum crop box dimensions in display px

export function CropOverlay({
  imageWidth,
  imageHeight,
  displayWidth,
  displayHeight,
  locale,
  onConfirm,
  onCancel,
}: CropOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Default selection: covers the ENTIRE image (user can then drag/resize
  // inward to choose the area they want to keep).
  const [rect, setRect] = useState<CropRect>(() => ({
    x: 0,
    y: 0,
    width: displayWidth,
    height: displayHeight,
  }));
  const [drag, setDrag] = useState<DragMode>({ type: "none" });

  // Convert a pointer event to overlay-relative coordinates
  const getPointer = useCallback((e: PointerEvent | React.PointerEvent) => {
    const el = overlayRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    };
  }, []);

  const clampRect = useCallback((r: CropRect): CropRect => {
    return {
      x: Math.max(0, Math.min(r.x, displayWidth - r.width)),
      y: Math.max(0, Math.min(r.y, displayHeight - r.height)),
      width: Math.max(MIN_SIZE, Math.min(r.width, displayWidth)),
      height: Math.max(MIN_SIZE, Math.min(r.height, displayHeight)),
    };
  }, [displayWidth, displayHeight]);

  // ===== Pointer handlers =====

  const handleOverlayPointerDown = (e: React.PointerEvent) => {
    if (drag.type !== "none") return;
    const p = getPointer(e);
    // Check if pointer is inside the current rect → start moving
    if (
      p.x >= rect.x && p.x <= rect.x + rect.width &&
      p.y >= rect.y && p.y <= rect.y + rect.height
    ) {
      setDrag({ type: "move", offsetX: p.x - rect.x, offsetY: p.y - rect.y });
    } else {
      // Start a new selection
      setDrag({ type: "new", startX: p.x, startY: p.y });
      setRect({ x: p.x, y: p.y, width: 0, height: 0 });
    }
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (drag.type === "none") return;
    const p = getPointer(e);

    if (drag.type === "new") {
      // Draw new rect from drag.startX/Y to current p
      const x = Math.min(drag.startX, p.x);
      const y = Math.min(drag.startY, p.y);
      const width = Math.abs(p.x - drag.startX);
      const height = Math.abs(p.y - drag.startY);
      setRect(clampRect({ x, y, width, height }));
    } else if (drag.type === "move") {
      setRect(clampRect({
        x: p.x - drag.offsetX,
        y: p.y - drag.offsetY,
        width: rect.width,
        height: rect.height,
      }));
    } else if (drag.type === "resize") {
      const newRect = { ...rect };
      switch (drag.handle) {
        case "nw":
          newRect.x = Math.min(p.x, rect.x + rect.width - MIN_SIZE);
          newRect.y = Math.min(p.y, rect.y + rect.height - MIN_SIZE);
          newRect.width = rect.x + rect.width - newRect.x;
          newRect.height = rect.y + rect.height - newRect.y;
          break;
        case "n":
          newRect.y = Math.min(p.y, rect.y + rect.height - MIN_SIZE);
          newRect.height = rect.y + rect.height - newRect.y;
          break;
        case "ne":
          newRect.y = Math.min(p.y, rect.y + rect.height - MIN_SIZE);
          newRect.width = Math.max(MIN_SIZE, p.x - rect.x);
          newRect.height = rect.y + rect.height - newRect.y;
          break;
        case "e":
          newRect.width = Math.max(MIN_SIZE, p.x - rect.x);
          break;
        case "se":
          newRect.width = Math.max(MIN_SIZE, p.x - rect.x);
          newRect.height = Math.max(MIN_SIZE, p.y - rect.y);
          break;
        case "s":
          newRect.height = Math.max(MIN_SIZE, p.y - rect.y);
          break;
        case "sw":
          newRect.x = Math.min(p.x, rect.x + rect.width - MIN_SIZE);
          newRect.width = rect.x + rect.width - newRect.x;
          newRect.height = Math.max(MIN_SIZE, p.y - rect.y);
          break;
        case "w":
          newRect.x = Math.min(p.x, rect.x + rect.width - MIN_SIZE);
          newRect.width = rect.x + rect.width - newRect.x;
          break;
      }
      setRect(clampRect(newRect));
    }
  }, [drag, rect, getPointer, clampRect]);

  const handlePointerUp = useCallback(() => {
    setDrag({ type: "none" });
  }, []);

  // ===== Global listeners while dragging =====
  useEffect(() => {
    if (drag.type === "none") return;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [drag, handlePointerMove, handlePointerUp]);

  // ===== Keyboard: Esc to cancel, Enter to confirm =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm(rect);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rect, onCancel, onConfirm]);

  // ===== Compute display → image space conversion =====
  const scaleX = imageWidth / displayWidth;
  const scaleY = imageHeight / displayHeight;

  const handleConfirm = () => {
    // Convert display rect to image-space rect for the API
    onConfirm({
      x: rect.x * scaleX,
      y: rect.y * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    });
  };

  // ===== Compute crop box style for the rendered selection =====
  const selStyle: React.CSSProperties = {
    position: "absolute",
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    border: "2px solid #00d4ff",
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
    cursor: drag.type === "move" ? "grabbing" : "grab",
  };

  const t = (ar: string, en: string) => (locale === "ar" ? ar : en);

  // ===== Resize handle renderers =====
  const handleStyle = (pos: HandlePosition): React.CSSProperties => {
    const size = 12;
    const base: React.CSSProperties = {
      position: "absolute",
      width: size,
      height: size,
      background: "#00d4ff",
      border: "2px solid #000",
      borderRadius: 2,
      cursor: "nwse-resize",
    };
    switch (pos) {
      case "nw": return { ...base, top: -size / 2, left: -size / 2, cursor: "nwse-resize" };
      case "n":  return { ...base, top: -size / 2, left: "50%", marginLeft: -size / 2, cursor: "ns-resize" };
      case "ne": return { ...base, top: -size / 2, right: -size / 2, cursor: "nesw-resize" };
      case "e":  return { ...base, top: "50%", right: -size / 2, marginTop: -size / 2, cursor: "ew-resize" };
      case "se": return { ...base, bottom: -size / 2, right: -size / 2, cursor: "nwse-resize" };
      case "s":  return { ...base, bottom: -size / 2, left: "50%", marginLeft: -size / 2, cursor: "ns-resize" };
      case "sw": return { ...base, bottom: -size / 2, left: -size / 2, cursor: "nesw-resize" };
      case "w":  return { ...base, top: "50%", left: -size / 2, marginTop: -size / 2, cursor: "ew-resize" };
    }
  };

  // "rule of thirds" guide lines
  const guideLines = (
    <>
      <div style={{ position: "absolute", left: "33.33%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.25)" }} />
      <div style={{ position: "absolute", left: "66.66%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.25)" }} />
      <div style={{ position: "absolute", top: "33.33%", left: 0, height: 1, width: "100%", background: "rgba(255,255,255,0.25)" }} />
      <div style={{ position: "absolute", top: "66.66%", left: 0, height: 1, width: "100%", background: "rgba(255,255,255,0.25)" }} />
    </>
  );

  return (
    <div
      ref={overlayRef}
      onPointerDown={handleOverlayPointerDown}
      style={{
        position: "absolute",
        inset: 0,
        cursor: drag.type === "new" ? "crosshair" : "default",
        touchAction: "none",
        zIndex: 20,
      }}
    >
      {/* The crop selection box */}
      <div style={selStyle}>
        {guideLines}
        {/* 8 resize handles */}
        {HANDLES.map((pos) => (
          <div
            key={pos}
            style={handleStyle(pos)}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDrag({ type: "resize", handle: pos });
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
          />
        ))}
      </div>

      {/* Top toolbar */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
          padding: "6px 8px",
          background: "rgba(0,0,0,0.85)",
          border: "1px solid rgba(0,212,255,0.4)",
          borderRadius: 8,
          color: "#fff",
          fontSize: 12,
          backdropFilter: "blur(8px)",
          zIndex: 21,
        }}
      >
        <span style={{ fontFamily: "monospace" }}>
          {Math.round(rect.x * scaleX)}×{Math.round(rect.y * scaleY)}
          {" · "}
          {Math.round(rect.width * scaleX)}×{Math.round(rect.height * scaleY)}
        </span>
      </div>

      {/* Bottom action buttons */}
      <div
        style={{
          position: "absolute",
          bottom: 12,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
          zIndex: 21,
        }}
      >
        <button
          onClick={handleConfirm}
          style={{
            padding: "8px 16px",
            background: "#00d4ff",
            color: "#000",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Check size={16} />
          {t("موافق", "OK")}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 16px",
            background: "rgba(255,255,255,0.1)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 6,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <X size={16} />
          {t("إلغاء", "Cancel")}
        </button>
      </div>

      {/* Helper text at top-left */}
      <div
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          padding: "4px 8px",
          background: "rgba(0,0,0,0.7)",
          borderRadius: 4,
          color: "rgba(255,255,255,0.8)",
          fontSize: 10,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Move size={12} />
        {t("ارسم مربعاً جديداً أو عدّل المربع الحالي", "Draw a new box or adjust the existing one")}
      </div>
    </div>
  );
}
