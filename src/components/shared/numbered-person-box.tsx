"use client";

import { cn } from "@/lib/utils";

/**
 * A numbered, clickable bounding box overlaid on an image preview.
 * Coordinates are normalized (0..1) relative to the wrapped <img>.
 *
 * Used by the Studio tab (source persons = cyan, garment reference =
 * fuchsia). Mapped boxes turn emerald so the user can see which
 * persons/outfits participate in the swap.
 */
export function NumberedPersonBox({
  box,
  number,
  mapped,
  accent,
  title,
  onClick,
}: {
  box: [number, number, number, number];
  number: number;
  mapped: boolean;
  accent: "cyan" | "fuchsia";
  title?: string;
  onClick: () => void;
}) {
  const borderCls = mapped
    ? "border-emerald-400 bg-emerald-400/10"
    : accent === "cyan"
      ? "border-cyan-300/90 bg-cyan-300/5"
      : "border-fuchsia-400/80 bg-fuchsia-400/5";
  const badgeCls = mapped
    ? "bg-emerald-500"
    : accent === "cyan"
      ? "bg-cyan-500"
      : "bg-fuchsia-500";
  const [x1, y1, x2, y2] = box;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="absolute z-20 group cursor-pointer"
      style={{
        left: `${x1 * 100}%`,
        top: `${y1 * 100}%`,
        width: `${Math.max(0, (x2 - x1) * 100)}%`,
        height: `${Math.max(0, (y2 - y1) * 100)}%`,
      }}
    >
      <span
        className={cn(
          "absolute inset-0 rounded-lg border-2 group-hover:bg-emerald-400/25 transition-colors shadow-[0_0_0_1px_rgba(0,0,0,0.15)]",
          borderCls
        )}
      />
      <span
        className={cn(
          "absolute min-w-[20px] h-[20px] px-1 rounded-full text-[10px] font-extrabold text-white flex items-center justify-center shadow-md",
          badgeCls,
          y1 < 0.06 ? "top-0.5 start-0.5" : "-top-2 -start-2"
        )}
      >
        {number}
      </span>
    </button>
  );
}
