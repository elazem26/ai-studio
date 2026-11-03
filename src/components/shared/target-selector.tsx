"use client";

import { useI18n } from "@/lib/i18n";
import { useUIStore, type TargetKey } from "@/stores/ui-store";
import { cn } from "@/lib/utils";
import { Image as ImageIcon, Layers, Sparkles } from "lucide-react";

interface TargetSelectorProps {
  /** Section id (e.g. "studio", "imageTools", "faceSwap", "garmentEditor") */
  section: string;
  /** Optional: which targets to show. Default: all three. */
  options?: TargetKey[];
  /** Optional: small variant for inline use */
  size?: "sm" | "default";
  /** Optional className override */
  className?: string;
}

/**
 * TargetSelector
 *
 * A 3-way selector that lets the user choose WHICH image to apply
 * the next edit/enhancement to:
 *
 *   ┌──────────────┬──────────────┬──────────────┐
 *   │   المصدر     │   المرجع      │   النتيجة     │
 *   │   Source     │   Reference   │   Result     │
 *   └──────────────┴──────────────┴──────────────┘
 *
 * Used in: Studio, Image Tools, Face Swap, Garment Editor.
 */
export function TargetSelector({
  section,
  options = ["source", "reference", "result"],
  size = "sm",
  className,
}: TargetSelectorProps) {
  const t = useI18n((s) => s.t);
  const locale = useI18n((s) => s.locale);
  const target = useUIStore((s) => s.targets[section] ?? "source");
  const setTarget = useUIStore((s) => s.setTarget);

  const isAr = locale === "ar";

  const items: { key: TargetKey; icon: typeof ImageIcon; ar: string; en: string }[] = [
    { key: "source", icon: ImageIcon, ar: "المصدر", en: "Source" },
    { key: "reference", icon: Layers, ar: "المرجع", en: "Reference" },
    { key: "result", icon: Sparkles, ar: "النتيجة", en: "Result" },
  ];

  const filtered = items.filter((i) => options.includes(i.key));

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 p-0.5 rounded-md bg-muted/40 ring-1 ring-border",
        size === "sm" ? "h-7" : "h-9",
        className
      )}
      role="radiogroup"
      aria-label={isAr ? "اختر الهدف" : "Select target"}
    >
      {filtered.map((item) => {
        const Icon = item.icon;
        const active = target === item.key;
        return (
          <button
            key={item.key}
            onClick={() => setTarget(section, item.key)}
            role="radio"
            aria-checked={active}
            title={isAr ? item.ar : item.en}
            className={cn(
              "flex items-center gap-1 rounded font-medium transition-all",
              size === "sm" ? "h-6 px-2 text-[10px]" : "h-8 px-3 text-xs",
              active
                ? "bg-cyan-accent/15 text-cyan-accent ring-1 ring-cyan-accent/30"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
            <span>{isAr ? item.ar : item.en}</span>
          </button>
        );
      })}
    </div>
  );
}
