"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import { useUIStore } from "@/stores/ui-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Maximize2, ZoomIn, ZoomOut, MoveHorizontal } from "lucide-react";

/**
 * Before/After comparison slider.
 *
 * BUG FIX (2026-10-30) — "صورة فوق صورة":
 *  - The drag used to start ONLY on the 2px divider (onMouseDown/onTouchStart
 *    were bound to the divider alone). On touch devices — and for most mouse
 *    users — grabbing a 2px strip is practically impossible, so the modal
 *    looked like a static "result image stamped over the source image".
 *  - Now the drag starts ANYWHERE on the image area (mouse + touch) and the
 *    divider follows the pointer. A tap also repositions the split.
 *  - The comparison area is forced to dir="ltr" so the geometry (source
 *    clipped from the left, result revealed on the right) and the two labels
 *    stay correct in BOTH languages. Previously, in the Arabic RTL layout the
 *    CSS overconstrained positioning (inset-0 + width%) anchored the clip
 *    window to the RIGHT edge while the "المولدة" label stayed at the physical
 *    right — the labels described the wrong halves.
 */
export function ComparisonModal() {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const source = useImageStore((s) => s.source);
  const results = useImageStore((s) => s.results);
  const activeResultId = useImageStore((s) => s.activeResultId);
  const active = results.find((r) => r.id === activeResultId) ?? results[0];
  const open = useUIStore((s) => s.compareOpen);
  const setOpen = useUIStore((s) => s.setCompareOpen);
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const dragRef = useRef(false);
  const areaRef = useRef<HTMLDivElement | null>(null);

  /** Move the split to the pointer position (0..100). */
  const moveTo = (clientX: number) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(2, Math.min(98, x)));
  };

  const onDown = (clientX: number) => {
    dragRef.current = true;
    moveTo(clientX); // a tap anywhere repositions the split immediately
  };

  if (!source || !active) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[90vw] w-[90vw] h-[85vh] p-0 overflow-hidden gap-0 flex flex-col">
        <DialogHeader className="px-4 py-2 border-b border-panel-border flex-row items-center justify-between">
          <DialogTitle className="text-sm flex items-center gap-2">
            <Maximize2 className="h-4 w-4 text-cyan-accent" />
            {t("comparison.title")}
          </DialogTitle>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              className="p-1.5 rounded hover:bg-muted"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="text-[10px] font-mono text-cyan-accent w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
              className="p-1.5 rounded hover:bg-muted"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </DialogHeader>

        {/* dir="ltr": the split geometry is physical, not logical — keep it
            identical in Arabic and English so labels always match their half */}
        <div dir="ltr" className="flex-1 relative overflow-hidden bg-black/60 select-none">
          <div
            ref={areaRef}
            className="absolute inset-0 touch-none"
            onMouseDown={(e) => { e.preventDefault(); onDown(e.clientX); }}
            onMouseMove={(e) => { if (dragRef.current) { e.preventDefault(); moveTo(e.clientX); } }}
            onMouseUp={() => { dragRef.current = false; }}
            onMouseLeave={() => { dragRef.current = false; }}
            onTouchStart={(e) => { onDown(e.touches[0].clientX); }}
            onTouchMove={(e) => { if (dragRef.current) { e.preventDefault(); moveTo(e.touches[0].clientX); } }}
            onTouchEnd={() => { dragRef.current = false; }}
          >
            {/* Generated image (background, revealed on the right of the split) */}
            <img
              src={active.url}
              alt="Generated"
              className="absolute inset-0 w-full h-full object-contain"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
              draggable={false}
            />

            {/* Original image clipped to the left portion */}
            <div
              className="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${pos}%` }}
            >
              <img
                src={source.url}
                alt="Original"
                className="absolute inset-y-0 left-0 h-full object-contain"
                style={{
                  width: `${100 * (100 / Math.max(pos, 1))}%`,
                  transform: `scale(${zoom})`,
                  transformOrigin: "left center",
                  maxWidth: "none",
                }}
                draggable={false}
              />
              {/* Label — always over the ORIGINAL (left) half */}
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium pointer-events-none">
                {t("comparison.original")}
              </div>
            </div>

            {/* Label — always over the GENERATED (right) half */}
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium pointer-events-none">
              {t("comparison.generated")}
            </div>

            {/* Slider divider — visual only now; the WHOLE area drags it */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-cyan-accent pointer-events-none"
              style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-cyan-accent flex items-center justify-center shadow-lg">
                <MoveHorizontal className="h-4 w-4 text-black" />
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-2 border-t border-panel-border text-[10px] text-muted-foreground text-center">
          {t("comparison.slider")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
