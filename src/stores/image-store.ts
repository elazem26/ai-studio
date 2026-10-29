"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useUndoRedoStore } from "./undo-redo-store";

export interface UploadedImage {
  /** Server-side file id (cuid) */
  id: string;
  /** Original file name */
  name: string;
  /** Server-side path under /data/uploads */
  path: string;
  /** Public-relative URL for <img src> */
  url: string;
  /** Detected MIME type */
  mime: string;
  /** File size in bytes */
  size: number;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** Detected format (jpeg/png/webp/tiff) */
  format: string;
  /** Detection of garment type, if applicable */
  detectedGarmentType?: "tops" | "bottoms" | "dress" | "outerwear" | "full" | "accessories";
  /** Detected dominant color (hex) */
  detectedColor?: string;
  /** Detected pattern */
  detectedPattern?: string;
  /** Upload timestamp */
  uploadedAt: number;
}

interface ImageState {
  source: UploadedImage | null;
  garment: UploadedImage | null;
  /**
   * ALL garment/reference images (multi-reference support): the user can
   * add several reference photos and map each source person to a
   * different one. `garment` mirrors the ACTIVE entry so every legacy
   * consumer keeps working unchanged.
   */
  garmentList: UploadedImage[];
  /** Text description for the garment (used when garment mode is "description") */
  garmentDescription: string;
  /** Active result image (one of results[]) */
  activeResultId: string | null;
  /** Generated result images */
  results: Array<{
    id: string;
    url: string;
    thumbnailUrl: string;
    seed: string;
    width: number;
    height: number;
    qualityScore: number | null;
    createdAt: number;
  }>;

  /**
   * Last image worked on in the Image Tools panel.
   * Used by the Garment Editor when the user picks
   * "imageTools" as the source tab.
   */
  imageToolsImage: UploadedImage | null;

  /**
   * Most recent SOURCE image uploaded in the Face Swap panel.
   * Used by the Garment Editor when the user picks
   * "faceSwap" as the source tab and selects "source" target.
   */
  faceSwapSource: UploadedImage | null;

  /**
   * Most recent FACE/REFERENCE image uploaded in the Face Swap panel.
   * Used by the Garment Editor when the user picks
   * "faceSwap" as the source tab and selects "reference" target.
   */
  faceSwapFace: UploadedImage | null;
  /**
   * ALL face/reference images in the Face Swap panel (multi-reference):
   * several reference photos, each mapped to a different source person.
   * `faceSwapFace` mirrors the ACTIVE entry for legacy consumers.
   */
  faceSwapFaceList: UploadedImage[];

  /**
   * Most recent RESULT from the Face Swap panel.
   * Used by the Garment Editor when the user picks
   * "faceSwap" as the source tab and selects "result" target.
   */
  faceSwapResult: UploadedImage | null;

  setSource: (img: UploadedImage | null) => void;
  setGarment: (img: UploadedImage | null) => void;
  /** Replace the whole reference list (garment mirrors the active entry). */
  setGarmentList: (list: UploadedImage[], activeIndex?: number) => void;
  setGarmentDescription: (text: string) => void;
  setResults: (r: ImageState["results"]) => void;
  addResult: (r: ImageState["results"][number]) => void;
  removeResult: (id: string) => void;
  setActiveResult: (id: string | null) => void;
  clearResults: () => void;
  setImageToolsImage: (img: UploadedImage | null) => void;
  setFaceSwapSource: (img: UploadedImage | null) => void;
  setFaceSwapFace: (img: UploadedImage | null) => void;
  /** Replace the whole face-reference list (faceSwapFace mirrors active). */
  setFaceSwapFaceList: (list: UploadedImage[], activeIndex?: number) => void;
  setFaceSwapResult: (img: UploadedImage | null) => void;
  reset: () => void;

  /**
   * Snapshot the current studio state (source + garment + results) into
   * the undo-redo history, with a human-readable label.
   * Section "studio" is used so the StudioHeader's Undo/Redo buttons
   * (which map to that section when the studio tab is active) work.
   */
  pushStudioHistory: (label: string) => void;
  /**
   * Restore a previously-snapshotted studio state. Called by the
   * studio page's "undo-redo" event listener when section === "studio".
   */
  restoreStudioSnapshot: (snapshot: StudioSnapshot) => void;
}

/**
 * Shape of the snapshot stored in the undo-redo store for the studio tab.
 */
export interface StudioSnapshot {
  faceSwapSource: UploadedImage | null;
  faceSwapFace: UploadedImage | null;
  faceSwapFaceList: UploadedImage[];
  faceSwapResult: ImageState["faceSwapResult"];
  source: UploadedImage | null;
  garment: UploadedImage | null;
  garmentList: UploadedImage[];
  garmentDescription: string;
  results: ImageState["results"];
  activeResultId: string | null;
}

const STUDIO_SECTION = "studio";

export const useImageStore = create<ImageState>()(
  persist(
    (set, get) => ({
      source: null,
      garment: null,
      garmentList: [],
      garmentDescription: "",
      activeResultId: null,
      results: [],
      imageToolsImage: null,
      faceSwapSource: null,
      faceSwapFace: null,
      faceSwapFaceList: [],
      faceSwapResult: null,
      setSource: (img) => set({ source: img }),
      setGarment: (img) => set({ garment: img }),
      setGarmentList: (list, activeIndex) =>
        set((s) => {
          const idx = Math.min(activeIndex ?? Math.max(0, list.length - 1), Math.max(0, list.length - 1));
          return { garmentList: list, garment: list[idx] ?? null };
        }),
      setGarmentDescription: (text) => set({ garmentDescription: text }),
      setResults: (r) => set({ results: r, activeResultId: r[0]?.id ?? null }),
      addResult: (r) =>
        set((s) => ({ results: [...s.results, r], activeResultId: r.id })),
      removeResult: (id) =>
        set((s) => {
          const results = s.results.filter((r) => r.id !== id);
          const activeResultId =
            s.activeResultId === id ? results[0]?.id ?? null : s.activeResultId;
          return { results, activeResultId };
        }),
      setActiveResult: (id) => set({ activeResultId: id }),
      clearResults: () => set({ results: [], activeResultId: null }),
      setImageToolsImage: (img) => set({ imageToolsImage: img }),
      setFaceSwapSource: (img) => set({ faceSwapSource: img }),
      setFaceSwapFace: (img) => set({ faceSwapFace: img }),
      setFaceSwapFaceList: (list, activeIndex) =>
        set((s) => {
          const idx = Math.min(activeIndex ?? Math.max(0, list.length - 1), Math.max(0, list.length - 1));
          return { faceSwapFaceList: list, faceSwapFace: list[idx] ?? null };
        }),
      setFaceSwapResult: (img) => set({ faceSwapResult: img }),
      reset: () => set({ source: null, garment: null, garmentList: [], garmentDescription: "", results: [], activeResultId: null, imageToolsImage: null, faceSwapSource: null, faceSwapFace: null, faceSwapFaceList: [], faceSwapResult: null }),

      /**
       * Captures the CURRENT studio state into the undo-redo history.
       * Call BEFORE applying a new mutation so undo will return to this
       * prior state.
       */
      pushStudioHistory: (label: string) => {
        const s = get();
        const snapshot: StudioSnapshot = {
          source: s.source,
          garment: s.garment,
          garmentList: s.garmentList,
          garmentDescription: s.garmentDescription,
          results: s.results,
          activeResultId: s.activeResultId,
          faceSwapSource: s.faceSwapSource,
          faceSwapFace: s.faceSwapFace,
          faceSwapFaceList: s.faceSwapFaceList,
          faceSwapResult: s.faceSwapResult,
        };
        useUndoRedoStore.getState().pushHistory(STUDIO_SECTION, label, snapshot);
      },

      /**
       * Restores the studio state from a snapshot. Triggered by the
       * "undo-redo" CustomEvent dispatched from StudioHeader.
       */
      restoreStudioSnapshot: (snapshot: StudioSnapshot) => {
        set({
          source: snapshot.source,
          garment: snapshot.garment,
          garmentList: snapshot.garmentList ?? (snapshot.garment ? [snapshot.garment] : []),
          garmentDescription: snapshot.garmentDescription,
          results: snapshot.results,
          activeResultId: snapshot.activeResultId,
          faceSwapSource: snapshot.faceSwapSource,
          faceSwapFace: snapshot.faceSwapFace,
          faceSwapFaceList: snapshot.faceSwapFaceList ?? (snapshot.faceSwapFace ? [snapshot.faceSwapFace] : []),
          faceSwapResult: snapshot.faceSwapResult,
        });
      },
    }),
    {
      name: "ai-studio-images",
      storage: createJSONStorage(() => localStorage),
      // Persist EVERYTHING the user uploaded/generated so the state
      // survives across tab navigation and page reloads (within the
      // same browser session). Images are only cleared when the user
      // explicitly clears them, or when the session ends (browser
      // tab closed) and the auto-clear handler runs.
      partialize: (s) => ({
        source: s.source,
        garment: s.garment,
        garmentList: s.garmentList,
        garmentDescription: s.garmentDescription,
        imageToolsImage: s.imageToolsImage,
        faceSwapSource: s.faceSwapSource,
        faceSwapFace: s.faceSwapFace,
        faceSwapFaceList: s.faceSwapFaceList,
        faceSwapResult: s.faceSwapResult,
        // PERSIST results too so they don't vanish when the user
        // navigates to another tab and comes back.
        results: s.results,
        activeResultId: s.activeResultId,
      }),
    }
  )
);
