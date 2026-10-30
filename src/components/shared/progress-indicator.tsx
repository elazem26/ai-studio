"use client";

import { useEffect, useState, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProgressIndicatorProps {
  /** True when any operation is in progress */
  busy: boolean;
  /** Label for the operation (e.g. "تبديل الوجه...", "رفع الصورة...") */
  label?: string;
  className?: string;
}

/**
 * ProgressIndicator — beautiful, real-time progress bar for ALL operations.
 *
 * Features:
 *   ✓ Real elapsed time (not estimated/random)
 *   ✓ Color-shifting gradient bar (yellow → orange → lime → green → olive → cyan → blue → navy)
 *   ✓ Indeterminate animated bar with gradient
 *   ✓ Spinner + label + elapsed seconds
 *   ✓ Auto-hides when not busy
 *
 * Used for: upload, face-swap, enhance, colorize, restore, filter, etc.
 */
export function ProgressIndicator({ busy, label, className }: ProgressIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);
  const [colorIndex, setColorIndex] = useState(0);
  const startRef = useRef<number>(0);

  // Color palette — shifts over time for visual interest
  // Each entry is a CSS gradient (from-color → to-color)
  const COLORS = [
    "from-yellow-400 to-orange-400",       // 0: yellow → orange
    "from-orange-400 to-lime-400",          // 1: orange → lime
    "from-lime-400 to-green-400",           // 2: lime → green
    "from-green-400 to-emerald-400",        // 3: green → emerald
    "from-emerald-400 to-teal-400",         // 4: emerald → teal
    "from-teal-400 to-cyan-400",            // 5: teal → cyan
    "from-cyan-400 to-sky-400",             // 6: cyan → sky blue
    "from-sky-400 to-blue-400",             // 7: sky → blue
    "from-blue-400 to-indigo-400",         // 8: blue → indigo
    "from-indigo-400 to-violet-400",        // 9: indigo → violet
    "from-violet-400 to-fuchsia-400",       // 10: violet → fuchsia
    "from-fuchsia-400 to-pink-400",         // 11: fuchsia → pink
  ];

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      setColorIndex(0);
      return;
    }

    // Record the real start time
    startRef.current = Date.now();

    // Tick every 200ms for smooth color transitions
    const interval = setInterval(() => {
      const secs = (Date.now() - startRef.current) / 1000;
      setElapsed(secs);

      // Shift color every 2 seconds
      const idx = Math.floor(secs / 2) % COLORS.length;
      setColorIndex(idx);
    }, 200);

    return () => clearInterval(interval);
  }, [busy]);

  if (!busy) return null;

  const effectiveLabel = label ?? "جارٍ المعالجة...";
  const currentGradient = COLORS[colorIndex];
  const nextGradient = COLORS[(colorIndex + 1) % COLORS.length];

  // Format time nicely
  const timeText = elapsed < 1
    ? `${Math.round(elapsed * 10) / 10}ث`
    : elapsed < 60
    ? `${Math.round(elapsed)}ث`
    : `${Math.floor(elapsed / 60)}د ${Math.round(elapsed % 60)}ث`;

  return (
    <div className={cn("w-full space-y-1.5", className)}>
      {/* Label + elapsed time */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1.5 text-cyan-accent">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="font-medium">{effectiveLabel}</span>
        </div>
        <span className="font-mono text-muted-foreground">{timeText}</span>
      </div>

      {/* Animated gradient progress bar */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted/20">
        {/* Indeterminate animated bar with gradient */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-all duration-500",
            currentGradient
          )}
          style={{
            width: "40%",
            animation: "progress-slide 1.8s ease-in-out infinite",
          }}
        />
        {/* Glow overlay */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full bg-gradient-to-r opacity-50 blur-[2px]",
            nextGradient
          )}
          style={{
            width: "30%",
            animation: "progress-slide 1.8s ease-in-out infinite",
            animationDelay: "0.3s",
          }}
        />
      </div>
    </div>
  );
}
