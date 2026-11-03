"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

/**
 * PanZoomImage — عارض صورة بتكبير حر وسحب حر بكل الاتجاهات.
 *
 * - عجلة الماوس: تكبير/تصغير (non-passive حتى لا تتحرك الصفحة)
 * - سحب بالماوس أو اللمس: تحريك حر للصورة في أي اتجاه
 * - نقر مزدوج: إعادة الضبط
 * - أزرار عائمة صغيرة (+ / − / إعادة)
 */

interface PanZoomImageProps {
  src: string;
  alt?: string;
  /** صنف حاوية العارض (يجب أن يكون relative + overflow-hidden) */
  className?: string;
  maxZoom?: number;
  minZoom?: number;
  onChangeZoom?: (z: number) => void;
}

export function PanZoomImage({
  src,
  alt = "",
  className = "",
  maxZoom = 12,
  minZoom = 0.2,
  onChangeZoom,
}: PanZoomImageProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);

  const setZoom = useCallback(
    (z: number) => {
      setZoomState(z);
      onChangeZoom?.(z);
    },
    [onChangeZoom]
  );

  // wheel zoom — native non-passive listener (React's onWheel is passive)
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom(Math.min(maxZoom, Math.max(minZoom, zoom * f)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom, maxZoom, minZoom, setZoom]);

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      ref={boxRef}
      className={`relative overflow-hidden select-none ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"} ${className}`}
      style={{ touchAction: "none" }}
      onPointerDown={(e) => {
        dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (dx === 0 && dy === 0) return;
        dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: true };
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      }}
      onPointerUp={() => (dragRef.current = null)}
      onPointerCancel={() => (dragRef.current = null)}
      onDoubleClick={reset}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt={alt}
        className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
        style={{
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "center center",
        }}
        draggable={false}
      />

      {/* floating mini controls */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full bg-black/55 backdrop-blur px-1.5 py-1 shadow-lg">
        <button
          type="button"
          className="w-6 h-6 rounded-full text-white/90 hover:bg-white/20 flex items-center justify-center"
          onClick={() => setZoom(Math.max(minZoom, zoom / 1.25))}
          title="تصغير"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] font-mono text-white/90 w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="w-6 h-6 rounded-full text-white/90 hover:bg-white/20 flex items-center justify-center"
          onClick={() => setZoom(Math.min(maxZoom, zoom * 1.25))}
          title="تكبير"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-4 bg-white/25" />
        <button
          type="button"
          className="w-6 h-6 rounded-full text-white/90 hover:bg-white/20 flex items-center justify-center"
          onClick={reset}
          title="إعادة الضبط (سحب حر بالماوس)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
