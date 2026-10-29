"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useImageStore } from "@/stores/image-store";
import { useUIStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  Printer,
  Wand2,
  X,
} from "lucide-react";

export function ZoomModal() {
  const t = useI18n((s) => s.t); useI18n((s) => s.locale);
  const results = useImageStore((s) => s.results);
  const activeResultId = useImageStore((s) => s.activeResultId);
  const active = results.find((r) => r.id === activeResultId) ?? results[0];
  const open = useUIStore((s) => s.zoomModalOpen);
  const setOpen = useUIStore((s) => s.setZoomModalOpen);
  const setExportOpen = useUIStore((s) => s.setExportModalOpen);
  const setPrintOpen = useUIStore((s) => s.setPrintModalOpen);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  if (!active) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[90vw] w-[90vw] h-[90vh] p-0 overflow-hidden gap-0 flex flex-col">
        <DialogHeader className="px-4 py-2 border-b border-panel-border flex-row items-center justify-between">
          <DialogTitle className="text-sm font-medium flex items-center gap-2">
            <Maximize className="h-4 w-4 text-cyan-accent" />
            {t("zoom.actualPixels")}
            <span className="text-[10px] text-muted-foreground">
              {active.width} × {active.height}
            </span>
          </DialogTitle>
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-mono text-cyan-accent w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
          </div>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center justify-center gap-1 py-1.5 border-b border-panel-border bg-muted/20">
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.1, z - 0.25))} title={t("zoom.zoomOut")}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setZoom(1)} title={t("zoom.fit")}>
            <span className="text-[10px]">{t("zoom.fit")}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setZoom(1)} title={t("zoom.actualSize")}>
            <span className="text-[10px]">100%</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(8, z + 0.25))} title={t("zoom.zoomIn")}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <span className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="sm" onClick={() => setExportOpen(true)} title={t("zoom.download")}>
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPrintOpen(true)} title={t("zoom.print")}>
            <Printer className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" disabled title={t("zoom.enhance")}>
            <Wand2 className="h-4 w-4" />
          </Button>
          <span className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} title={t("zoom.close")}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Image canvas */}
        <div
          className="flex-1 overflow-hidden relative bg-black/60 cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => {
            setDragging(true);
            lastPosRef.current = { x: e.clientX, y: e.clientY };
          }}
          onMouseMove={(e) => {
            if (!dragging) return;
            const dx = e.clientX - lastPosRef.current.x;
            const dy = e.clientY - lastPosRef.current.y;
            setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
            lastPosRef.current = { x: e.clientX, y: e.clientY };
          }}
          onMouseUp={() => {
            setDragging(false);
          }}
          onMouseLeave={() => {
            setDragging(false);
          }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = -e.deltaY * 0.001;
            setZoom((z) => Math.min(8, Math.max(0.1, z + delta)));
          }}
        >
          { }
          <img
            src={active.url}
            alt="Zoomed result"
            className="absolute left-1/2 top-1/2 max-w-none select-none pointer-events-none"
            style={{
              transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: dragging ? "none" : "transform 0.05s ease-out",
            }}
            draggable={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
