"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface GenerationSettings {
  /** Auto mode - ignore all manual settings and use defaults */
  autoMode: boolean;
  /** 0-100: how strictly the garment appearance is preserved */
  garmentFidelity: number;
  /** 0-100: how strictly the person identity is preserved */
  identityPreservation: number;
  /** 0-100: body shape preservation */
  bodyPreservation: number;
  /** 0-100: how much to relight garment to match scene */
  lightingMatch: number;
  /** 0-100: color matching strength */
  colorMatch: number;
  /** 0-100: texture fidelity */
  textureFidelity: number;
  /** Diffusion sampling steps */
  generationSteps: number;
  /** CFG guidance scale */
  guidance: number;
  /** Seed - null means random */
  seed: number | null;
  /** "standard" | "high" | "max" */
  resolution: "standard" | "high" | "max";
  /** 1, 2, 4, or 8 results */
  numResults: 1 | 2 | 4 | 8;
  /** Preset */
  preset: "balanced" | "realistic" | "creative" | "conservative";
}

interface SettingsState extends GenerationSettings {
  setAutoMode: (v: boolean) => void;
  setField: <K extends keyof GenerationSettings>(
    key: K,
    value: GenerationSettings[K]
  ) => void;
  applyPreset: (preset: GenerationSettings["preset"]) => void;
  reset: () => void;
}

const DEFAULTS: GenerationSettings = {
  autoMode: true,
  garmentFidelity: 75,
  identityPreservation: 90,
  bodyPreservation: 85,
  lightingMatch: 70,
  colorMatch: 75,
  textureFidelity: 70,
  generationSteps: 30,
  guidance: 7.5,
  seed: null,
  resolution: "high",
  numResults: 2,
  preset: "balanced",
};

const PRESETS: Record<
  GenerationSettings["preset"],
  Partial<GenerationSettings>
> = {
  balanced: {
    garmentFidelity: 75,
    identityPreservation: 90,
    bodyPreservation: 85,
    lightingMatch: 70,
    colorMatch: 75,
    textureFidelity: 70,
    generationSteps: 30,
    guidance: 7.5,
  },
  realistic: {
    garmentFidelity: 80,
    identityPreservation: 95,
    bodyPreservation: 90,
    lightingMatch: 80,
    colorMatch: 80,
    textureFidelity: 75,
    generationSteps: 40,
    guidance: 6.5,
  },
  creative: {
    garmentFidelity: 60,
    identityPreservation: 70,
    bodyPreservation: 65,
    lightingMatch: 60,
    colorMatch: 60,
    textureFidelity: 55,
    generationSteps: 50,
    guidance: 10,
  },
  conservative: {
    garmentFidelity: 90,
    identityPreservation: 98,
    bodyPreservation: 95,
    lightingMatch: 85,
    colorMatch: 85,
    textureFidelity: 85,
    generationSteps: 25,
    guidance: 5,
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      setAutoMode: (v) => set({ autoMode: v }),
      setField: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      applyPreset: (preset) =>
        set({
          ...PRESETS[preset],
          preset,
          autoMode: false,
        } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: "ai-studio-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/** Resolve effective settings: if autoMode, return preset=balanced defaults */
export function getEffectiveSettings(s: GenerationSettings): GenerationSettings {
  if (s.autoMode) {
    return { ...DEFAULTS, autoMode: true, preset: "balanced" };
  }
  return s;
}
