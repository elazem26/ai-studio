"use client";

import { create } from "zustand";

/**
 * Shared state for the Studio tab's NUMBERED-BOX garment swap.
 *
 * The Source panel shows numbered person boxes (cyan) and the Garment
 * panel shows numbered reference-person/clothing boxes (fuchsia).
 * The mapping rows define which reference outfit transfers onto which
 * source person. The ControlBar's Generate button routes to the
 * regional garment-swap pipeline when mappings are active.
 *
 * MULTI-REFERENCE: the user can add SEVERAL reference images. Every
 * mapping row carries `refImage` (index into the image-store's
 * garmentList) in addition to `refIndex` (the person box INSIDE that
 * image). `refBoxes` always mirrors the ACTIVE reference image so all
 * legacy consumers keep working unchanged.
 */

export type PersonBox = {
  index: number;
  bbox: [number, number, number, number];
  score?: number;
};

export type GarmentMapping = {
  sourceIndex: number;
  refIndex: number;
  /** Index into the reference-image list (0 = the first/primary image). */
  refImage: number;
};

interface GarmentMappingState {
  /** Master switch — when OFF the studio behaves exactly like before. */
  enabled: boolean;
  /** Detected torso boxes on the SOURCE image (normalized 0..1). */
  srcBoxes: PersonBox[];
  /** Detected torso boxes per reference image (normalized 0..1). */
  refBoxesByImage: PersonBox[][];
  /** Which reference image is currently previewed in the Garment panel. */
  activeRefImage: number;
  /** Mirrors refBoxesByImage[activeRefImage] (legacy single-image view). */
  refBoxes: PersonBox[];
  detecting: { source: boolean; ref: boolean };
  /** Mapping rows: (ref image R, outfit N) → source person M. */
  mappings: GarmentMapping[];
  /** Which mapping row the user is currently editing (box clicks apply to it). */
  activeRow: number;
  /** Bumped by the "re-detect" button to force hooks to re-run. */
  detectNonce: { source: number; ref: number };

  setEnabled: (v: boolean) => void;
  setSrcBoxes: (b: PersonBox[]) => void;
  /** Store boxes for one reference image (and mirror it when active). */
  setRefBoxesForImage: (imageIdx: number, b: PersonBox[]) => void;
  setRefBoxes: (b: PersonBox[]) => void;
  setActiveRefImage: (i: number) => void;
  setDetecting: (d: { source: boolean; ref: boolean }) => void;
  setMappings: (m: GarmentMapping[]) => void;
  setActiveRow: (i: number) => void;
  /** Apply a box click to the active mapping row. */
  setInActiveRow: (kind: "source" | "ref", idx: number) => void;
  /**
   * After the reference image at `imageIdx` was REPLACED (new upload,
   * same slot): reset that image's stale refIndex values to 0.
   */
  fixMappingsForImage: (imageIdx: number) => void;
  /**
   * After the reference image at `imageIdx` was REMOVED: remap rows
   * (refImage === idx → image 0; refImage > idx → shift down by 1).
   */
  fixAfterRefRemove: (imageIdx: number) => void;
  /** Clear one side's boxes + reset mappings (called when its image changes). */
  resetSide: (kind: "source" | "ref") => void;
  bumpDetect: (kind: "source" | "ref") => void;
  reset: () => void;
}

const singleRow = (): GarmentMapping[] => [{ sourceIndex: 0, refIndex: 0, refImage: 0 }];

export const useGarmentMappingStore = create<GarmentMappingState>()((set) => ({
  enabled: true,
  srcBoxes: [],
  refBoxesByImage: [],
  activeRefImage: 0,
  refBoxes: [],
  detecting: { source: false, ref: false },
  mappings: singleRow(),
  activeRow: 0,
  detectNonce: { source: 0, ref: 0 },

  setEnabled: (v) => set({ enabled: v }),
  setSrcBoxes: (b) => set({ srcBoxes: b }),
  setRefBoxesForImage: (imageIdx, b) =>
    set((s) => {
      const next = [...s.refBoxesByImage];
      next[imageIdx] = b;
      return {
        refBoxesByImage: next,
        refBoxes: s.activeRefImage === imageIdx ? b : s.refBoxes,
      };
    }),
  setRefBoxes: (b) =>
    set((s) => {
      const next = [...s.refBoxesByImage];
      next[s.activeRefImage] = b;
      return { refBoxesByImage: next, refBoxes: b };
    }),
  setActiveRefImage: (i) =>
    set((s) => ({
      activeRefImage: i,
      refBoxes: s.refBoxesByImage[i] ?? [],
    })),
  setDetecting: (d) => set({ detecting: d }),
  setMappings: (m) => set({ mappings: m }),
  setActiveRow: (i) => set({ activeRow: i }),

  setInActiveRow: (kind, idx) =>
    set((s) => {
      if (!s.mappings.length) return s;
      const i = Math.min(s.activeRow, s.mappings.length - 1);
      const next = [...s.mappings];
      next[i] =
        kind === "ref"
          ? { ...next[i], refIndex: idx, refImage: s.activeRefImage }
          : { ...next[i], sourceIndex: idx };
      return { mappings: next };
    }),

  fixMappingsForImage: (imageIdx) =>
    set((s) => {
      const count = (s.refBoxesByImage[imageIdx] ?? []).length;
      return {
        mappings: s.mappings.map((m) => {
          const ri = m.refImage ?? 0;
          if (ri !== imageIdx) return m;
          return m.refIndex >= count ? { ...m, refIndex: 0 } : m;
        }),
      };
    }),

  fixAfterRefRemove: (imageIdx) =>
    set((s) => ({
      refBoxesByImage: s.refBoxesByImage.filter((_, di) => di !== imageIdx),
      refBoxes: s.refBoxesByImage[Math.max(0, imageIdx - 1)] ?? [],
      activeRefImage: Math.max(0, Math.min(s.activeRefImage > imageIdx ? s.activeRefImage - 1 : s.activeRefImage, Math.max(0, s.refBoxesByImage.length - 2))),
      mappings: s.mappings.map((m) => {
        const ri = m.refImage ?? 0;
        if (ri === imageIdx) return { ...m, refImage: 0, refIndex: 0 };
        if (ri > imageIdx) return { ...m, refImage: ri - 1 };
        return m;
      }),
      activeRow: 0,
    })),

  resetSide: (kind) =>
    set((s) =>
      kind === "source"
        ? {
            srcBoxes: [],
            // Source indices are no longer valid after an image change.
            mappings: singleRow(),
            activeRow: 0,
          }
        : {
            refBoxesByImage: [],
            refBoxes: [],
            activeRefImage: 0,
            mappings: singleRow(),
            activeRow: 0,
          }
    ),

  bumpDetect: (kind) =>
    set((s) => ({
      detectNonce: { ...s.detectNonce, [kind]: s.detectNonce[kind] + 1 },
    })),

  reset: () =>
    set({
      srcBoxes: [],
      refBoxesByImage: [],
      refBoxes: [],
      activeRefImage: 0,
      detecting: { source: false, ref: false },
      mappings: singleRow(),
      activeRow: 0,
    }),
}));
