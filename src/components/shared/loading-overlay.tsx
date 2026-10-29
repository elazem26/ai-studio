"use client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
interface P { active: boolean; label?: string; hint?: string; className?: string; }
export function LoadingOverlay({ active, label, hint, className }: P) {
  const locale = useI18n(s => s.locale); const isAr = locale === "ar";
  if (!active) return null;
  return (<div className={cn("absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm", className)}><div className="relative mb-3"><div className="absolute inset-0 rounded-full bg-cyan-accent/20 animate-ping" /><Loader2 className="relative h-10 w-10 text-cyan-accent animate-spin" /></div><div className="text-sm font-medium text-cyan-accent">{label ?? (isAr ? "جارٍ المعالجة..." : "Processing...")}</div><div className="text-[10px] text-muted-foreground mt-1">{hint ?? (isAr ? "15-90 ثانية" : "15-90 seconds")}</div></div>);
}
