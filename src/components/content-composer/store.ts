"use client";

import { create } from "zustand";
import type { UploadedImage } from "@/stores/image-store";

/**
 * متجر لوحة «إضافة محتوى إلى الصورة» — وكيل الدمج الذكي.
 *
 * كل مربع (مصدر / مرجع / نتيجة) يحمل تاريخه الخاص:
 *   history: سلسلة الحالات (null = فارغ) و idx: الموضع الحالي
 *   ← الرجوع/التقدم تحت كل مربع يتنقل داخل تاريخه هو.
 */

export type ComposerBox = "source" | "reference" | "result";
export type ComposerPhase = "" | "understand" | "analyze" | "apply" | "finalizing";

export interface BoxState {
  img: UploadedImage | null;
  history: (UploadedImage | null)[];
  idx: number;
  /** زوم 0..100 — الصفر = الصورة كاملة داخل المربع (object-contain) */
  zoom: number;
  pan: { x: number; y: number };
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  at: number;
  /** تفاصيل تقنية اختيارية (الوصف الإنجليزي الذي أنتجه الوكيل) */
  detail?: string;
}

const emptyBox = (): BoxState => ({ img: null, history: [null], idx: 0, zoom: 0, pan: { x: 0, y: 0 } });

const MAX_HISTORY = 30;

interface ComposerState {
  source: BoxState;
  reference: BoxState;
  result: BoxState;
  messages: ChatMessage[];
  /** "" = الوكيل يختار تلقائيًا */
  size: string;
  busy: boolean;
  phase: ComposerPhase;
  progress: number;
  ttsEnabled: boolean;
  activeTaskId: string | null;

  setImage: (box: ComposerBox, img: UploadedImage, label?: string) => void;
  clearBox: (box: ComposerBox) => void;
  boxUndo: (box: ComposerBox) => void;
  boxRedo: (box: ComposerBox) => void;
  setZoom: (box: ComposerBox, z: number) => void;
  setPan: (box: ComposerBox, pan: { x: number; y: number }) => void;

  addMessage: (m: Omit<ChatMessage, "id" | "at">) => void;
  clearChat: () => void;
  setSize: (s: string) => void;
  setBusy: (v: boolean) => void;
  setPhase: (p: ComposerPhase) => void;
  setProgress: (v: number) => void;
  toggleTts: () => void;
  setActiveTaskId: (id: string | null) => void;
  resetAll: () => void;
}

export const useComposerStore = create<ComposerState>((set, get) => {
  const patchBox = (box: ComposerBox, patch: Partial<BoxState>) =>
    set((s) => ({ ...s, [box]: { ...s[box], ...patch } }) as Pick<ComposerState, ComposerBox>);

  return {
    source: emptyBox(),
    reference: emptyBox(),
    result: emptyBox(),
    messages: [
      {
        id: "welcome",
        role: "agent",
        text:
          "مرحبًا 👋 أنا وكيل الدمج الذكي.\n" +
          "١. ارفع صورة المصدر (مثال: رجل) وصورة المرجع (مثال: امرأة).\n" +
          "٢. اكتب لي أو تحدث لي ما تريد — مثال: «اجمعهما في صورة حفل زفافهما بملابس الزفاف والزوجة بشعر أسود طويل ناعم».\n" +
          "٣. سأفهم طلبك، أحلله، ثم أبني الصورة مع المحافظة على ملامح الوجه الحقيقية للشخصين.\n" +
          "بعدها اطلب أي منظر أو وضعية وسأعدّل الصورة تباعًا.",
        at: Date.now(),
      },
    ],
    size: "",
    busy: false,
    phase: "",
    progress: 0,
    ttsEnabled: false,
    activeTaskId: null,

    setImage: (box, img, label) => {
      const b = get()[box];
      const past = [...b.history.slice(0, b.idx + 1), img].slice(-MAX_HISTORY);
      patchBox(box, { img, history: past, idx: past.length - 1, zoom: 0, pan: { x: 0, y: 0 } });
      if (label) console.debug(`[composer] ${box} ← ${label}`);
    },

    clearBox: (box) => {
      // الإزالة تدخل التاريخ أيضًا حتى يمكن التراجع عنها
      const b = get()[box];
      const past = [...b.history.slice(0, b.idx + 1), null].slice(-MAX_HISTORY);
      patchBox(box, { img: null, history: past, idx: past.length - 1, zoom: 0, pan: { x: 0, y: 0 } });
    },

    boxUndo: (box) => {
      const b = get()[box];
      if (b.idx <= 0) return;
      const idx = b.idx - 1;
      patchBox(box, { idx, img: b.history[idx], zoom: 0, pan: { x: 0, y: 0 } });
    },

    boxRedo: (box) => {
      const b = get()[box];
      if (b.idx >= b.history.length - 1) return;
      const idx = b.idx + 1;
      patchBox(box, { idx, img: b.history[idx], zoom: 0, pan: { x: 0, y: 0 } });
    },

    setZoom: (box, z) => {
      const clamped = Math.min(100, Math.max(0, Math.round(z)));
      patchBox(box, { zoom: clamped, pan: clamped === 0 ? { x: 0, y: 0 } : get()[box].pan });
    },

    setPan: (box, pan) => patchBox(box, { pan }),

    addMessage: (m) =>
      set((s) => ({
        messages: [...s.messages, { ...m, id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now() }],
      })),

    clearChat: () => set({ messages: [] }),
    setSize: (size) => set({ size }),
    setBusy: (busy) => set({ busy, ...(busy ? { progress: 2, phase: "understand" } : { phase: "", progress: 0, activeTaskId: null }) }),
    setPhase: (phase) => set({ phase }),
    setProgress: (progress) => set({ progress: Math.min(100, Math.max(0, Math.round(progress))) }),
    toggleTts: () => set((s) => ({ ttsEnabled: !s.ttsEnabled })),
    setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
    resetAll: () => set({ source: emptyBox(), reference: emptyBox(), result: emptyBox(), messages: [], size: "", busy: false, phase: "", progress: 0, activeTaskId: null }),
  };
});

/** تحويل نتيجة أي API صور إلى UploadedImage لتخزينها في المربعات */
export function toUploadedImage(r: { url: string; path: string; width?: number; height?: number; size?: number }, name?: string): UploadedImage {
  return {
    id: r.path,
    name: name ?? r.url.split("/").pop() ?? "image.png",
    path: r.path,
    url: r.url,
    mime: "image/png",
    size: r.size ?? 0,
    width: r.width ?? 0,
    height: r.height ?? 0,
    format: "png",
    uploadedAt: Date.now(),
  };
}
