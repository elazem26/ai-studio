"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type GenerationMode = "cloud" | "local";

interface ModeState {
  mode: GenerationMode;
  setMode: (m: GenerationMode) => void;
  toggle: () => void;
}

/**
 * Controls which AI backend is used:
 *   - "cloud": Cloud AI via z-ai-web-dev-sdk (real results, images go to cloud)
 *   - "local": Local CatVTON Python backend (full privacy, requires GPU + Python)
 */
export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: "cloud", // default to cloud for working results out-of-the-box
      setMode: (m) => set({ mode: m }),
      toggle: () =>
        set((s) => ({ mode: s.mode === "cloud" ? "local" : "cloud" })),
    }),
    {
      name: "ai-studio-mode",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
