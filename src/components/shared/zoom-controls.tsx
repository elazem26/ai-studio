"use client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ZoomIn, ZoomOut, RotateCw } from "lucide-react";
interface P { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onReset: () => void; className?: string; compact?: boolean; }
export function ZoomControls({ zoom, onZoomIn, onZoomOut, onReset, className, compact }: P) {
  const locale = useI18n(s => s.locale); const isAr = locale === "ar";
  return (
    <div className={cn("absolute top-1 left-1 flex items-center gap-1 z-10", compact && "scale-90 origin-top-left", className)} dir="ltr">
      <button onClick={onZoomOut} disabled={zoom <= 1} title={isAr ? "تصغير" : "Out"} className={cn("h-7 w-7 rounded-md bg-black/70 text-white ring-1 ring-white/20 hover:bg-white/20 flex items-center justify-center", zoom <= 1 && "opacity-30 cursor-not-allowed")}><ZoomOut className="h-3.5 w-3.5" /></button>
      <button onClick={onReset} disabled={zoom === 1} title={isAr ? "ضبط" : "Reset"} className={cn("h-7 w-7 rounded-md bg-black/70 text-white ring-1 ring-white/20 hover:bg-white/20 flex items-center justify-center", zoom === 1 && "opacity-30")}><RotateCw className="h-3.5 w-3.5" /></button>
      <button onClick={onZoomIn} disabled={zoom >= 10} title={isAr ? "تكبير" : "In"} className={cn("h-7 w-7 rounded-md bg-black/70 text-white ring-1 ring-white/20 hover:bg-white/20 flex items-center justify-center", zoom >= 10 && "opacity-30")}><ZoomIn className="h-3.5 w-3.5" /></button>
      <div className="h-7 px-2 rounded-md bg-black/70 text-[10px] font-mono text-cyan-accent flex items-center justify-center ring-1 ring-white/20">{Math.round(zoom * 100)}%</div>
    </div>
  );
}
