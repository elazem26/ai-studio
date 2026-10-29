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
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

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

        <div className="flex-1 relative overflow-hidden bg-black/60 select-none">
          {/* Generated image (background) */}
          { }
          <img
            src={active.url}
            alt="Generated"
            className="absolute inset-0 w-full h-full object-contain"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
            draggable={false}
          />

          {/* Original image clipped to left portion (clipped by pos%) */}
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ width: `${pos}%` }}
          >
            { }
            <img
              src={source.url}
              alt="Original"
              className="absolute inset-0 h-full object-contain"
              style={{
                width: `${100 * (100 / pos)}%`,
                transform: `scale(${zoom})`,
                transformOrigin: "left center",
                maxWidth: "none",
              }}
              draggable={false}
            />
            {/* Label */}
            <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium">
              {t("comparison.original")}
            </div>
          </div>

          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] font-medium">
            {t("comparison.generated")}
          </div>

          {/* Slider divider */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-cyan-accent cursor-ew-resize"
            style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
            onMouseDown={(e) => {
              dragRef.current = true;
              e.preventDefault();
            }}
            onTouchStart={(e) => {
              dragRef.current = true;
              e.preventDefault();
            }}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-cyan-accent flex items-center justify-center shadow-lg">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 3L2 7L5 11M9 3L12 7L9 11" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* Drag overlay - captures mouse events across the whole area */}
          <div
            className="absolute inset-0"
            onMouseMove={(e) => {
              if (!dragRef.current) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * 100;
              setPos(Math.max(0, Math.min(100, x)));
            }}
            onMouseUp={() => { dragRef.current = false; }}
            onMouseLeave={() => { dragRef.current = false; }}
            onTouchMove={(e) => {
              if (!dragRef.current) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const x = ((e.touches[0].clientX - rect.left) / rect.width) * 100;
              setPos(Math.max(0, Math.min(100, x)));
            }}
            onTouchEnd={() => { dragRef.current = false; }}
          />
        </div>

        <div className="px-4 py-2 border-t border-panel-border text-[10px] text-muted-foreground text-center">
          {t("comparison.slider")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
