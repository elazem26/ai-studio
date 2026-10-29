"use client";
import { useEffect, type RefObject } from "react";
export function useWheelZoom(ref: RefObject<HTMLElement | null>, setZoom: (u: (z: number) => number) => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return; const el = ref.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const f = e.deltaY > 0 ? 0.9 : 1.1; setZoom(z => Math.max(1, Math.min(10, z * f))); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, setZoom, enabled]);
}
