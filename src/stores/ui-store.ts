"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type TabKey =
  | "studio"
  | "imageTools"
  | "faceSwap"
  | "garmentEditor"
  | "modelManager"
  | "agents"
  | "system"
  | "videoEditor"
  | "developer";

/**
 * Target selector type — used in every section to choose
 * which image (source / reference / result) should receive
 * the next edit operation.
 *
 * - "source"     → the original photo being edited
 * - "reference"  → the reference/garment/face image used for blending
 * - "result"     → the most recent AI-generated output
 */
export type TargetKey = "source" | "reference" | "result";

/**
 * Garment-editor source tab — picks which section's image
 * to use as the source for clothing edits.
 *
 * - "studio"     → use the source image uploaded in the Studio tab
 * - "imageTools" → use the most recent image in the Image Tools tab
 * - "faceSwap"   → use the most recent face-swap result
 */
export type GarmentSourceTab = "studio" | "imageTools" | "faceSwap";

export type ZoomLevel = number;

interface UIState {
  activeTab: TabKey;
  advancedOpen: boolean;
  zoomModalOpen: boolean;
  exportModalOpen: boolean;
  printModalOpen: boolean;
  compareOpen: boolean;
  zoom: ZoomLevel;
  pan: { x: number; y: number };

  /** Per-section target selector (which image to apply edits to) */
  targets: Record<string, TargetKey>;

  /** Which section's image the Garment Editor should operate on */
  garmentSourceTab: GarmentSourceTab;

  setActiveTab: (t: TabKey) => void;
  setAdvancedOpen: (v: boolean) => void;
  setZoomModalOpen: (v: boolean) => void;
  setExportModalOpen: (v: boolean) => void;
  setPrintModalOpen: (v: boolean) => void;
  setCompareOpen: (v: boolean) => void;
  setZoom: (z: ZoomLevel) => void;
  setPan: (p: { x: number; y: number }) => void;
  setTarget: (section: string, t: TargetKey) => void;
  getTarget: (section: string) => TargetKey;
  setGarmentSourceTab: (t: GarmentSourceTab) => void;
  reset: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      activeTab: "studio",
      advancedOpen: false,
      zoomModalOpen: false,
      exportModalOpen: false,
      printModalOpen: false,
      compareOpen: false,
      zoom: 1,
      pan: { x: 0, y: 0 },
      targets: {
        studio: "source",
        imageTools: "source",
        faceSwap: "result",
        garmentEditor: "source",
      },
      garmentSourceTab: "studio",
      setActiveTab: (t) => set({ activeTab: t }),
      setAdvancedOpen: (v) => set({ advancedOpen: v }),
      setZoomModalOpen: (v) => set({ zoomModalOpen: v }),
      setExportModalOpen: (v) => set({ exportModalOpen: v }),
      setPrintModalOpen: (v) => set({ printModalOpen: v }),
      setCompareOpen: (v) => set({ compareOpen: v }),
      setZoom: (z) => set({ zoom: z }),
      setPan: (p) => set({ pan: p }),
      setTarget: (section, t) =>
        set((s) => ({ targets: { ...s.targets, [section]: t } })),
      getTarget: (section) => get().targets[section] ?? "source",
      setGarmentSourceTab: (t) => set({ garmentSourceTab: t }),
      reset: () =>
        set({
          activeTab: "studio",
          zoomModalOpen: false,
          exportModalOpen: false,
          printModalOpen: false,
          compareOpen: false,
          zoom: 1,
          pan: { x: 0, y: 0 },
          targets: {
            studio: "source",
            imageTools: "source",
            faceSwap: "result",
            garmentEditor: "source",
          },
          garmentSourceTab: "studio",
        }),
    }),
    {
      name: "ai-studio-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        activeTab: s.activeTab,
        advancedOpen: s.advancedOpen,
        targets: s.targets,
        garmentSourceTab: s.garmentSourceTab,
      }),
    }
  )
);
