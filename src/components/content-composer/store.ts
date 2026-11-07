"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { UploadedImage } from "@/stores/image-store";

/**
 * متجر لوحة «إضافة محتوى إلى الصورة» — وكيل الدمج الذكي v2 (متعدد).
 *
 * - المربعان source/reference يقبلا عدة صور (أكثر من شخص في كل جهة):
 *   items + تاريخ كامل للقائمة (undo/redo) + صورة محددة للأدوات.
 * - مربع result يبقى صورة واحدة بتاريخها.
 * - الوضعيات (poses): عناق، قبلات، مصافحة... تُرسل مع كل طلب.
 *
 * كل مربع (مصدر / مرجع / نتيجة) يحمل شريط الأدوات السبعة:
 *   تحسين الجودة | حفظ | طباعة | تقدم | رجوع | زوم− إلى 0 | زوم+ للحد الأقصى
 * والزوم صفر = إظهار كامل الصور دائمًا داخل المربع (fit-to-box).
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

/** مربع متعدد الصور (المصدر/المرجع) */
export interface MultiBoxState {
  items: UploadedImage[];
  history: UploadedImage[][];
  idx: number;
  /** الصورة المحددة حاليًا (للأدوات: تحسين/حفظ/طباعة) */
  selected: number;
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

/** الوضعيات الجاهزة — أمثلة المستخدم: تبادل الأحضان، تبادل القبلات... */
export const POSE_OPTIONS: { id: string; label: string; emoji: string }[] = [
  { id: "hug", label: "تبادل الأحضان", emoji: "🤗" },
  { id: "kiss-cheek", label: "تبادل القبلات على الخد", emoji: "💋" },
  { id: "handshake", label: "مصافحة رسمية", emoji: "🤝" },
  { id: "side-by-side", label: "الوقوف جنباً إلى جنب", emoji: "🧍🧍" },
  { id: "arm-shoulder", label: "يد على الكتف", emoji: "🫱" },
  { id: "sitting", label: "الجلوس معاً", emoji: "🪑" },
  { id: "piggyback", label: "حمل على الظهر", emoji: "🎽" },
  { id: "high-five", label: "خمسات", emoji: "🖐" },
  { id: "dancing", label: "الرقص معاً", emoji: "💃" },
];

const emptyBox = (): BoxState => ({ img: null, history: [null], idx: 0, zoom: 0, pan: { x: 0, y: 0 } });
const emptyMulti = (): MultiBoxState => ({ items: [], history: [[]], idx: 0, selected: 0, zoom: 0, pan: { x: 0, y: 0 } });

const MAX_HISTORY = 20;
const MAX_ITEMS = 4;

interface ComposerState {
  source: MultiBoxState;
  reference: MultiBoxState;
  result: BoxState;
  messages: ChatMessage[];
  /** الوضعيات المختارة (معرفات POSE_OPTIONS) */
  poses: string[];
  /** "" = الوكيل يختار تلقائيًا */
  size: string;
  busy: boolean;
  phase: ComposerPhase;
  progress: number;
  ttsEnabled: boolean;
  activeTaskId: string | null;

  addItem: (box: "source" | "reference", img: UploadedImage) => void;
  removeItem: (box: "source" | "reference", index: number) => void;
  /** استبدال صورة بموقع معين (نتيجة التحسين مثلاً) — بلا إدخال تاريخ جديد */
  replaceItem: (box: "source" | "reference", index: number, img: UploadedImage) => void;
  selectItem: (box: "source" | "reference", index: number) => void;
  clearMultiBox: (box: "source" | "reference") => void;
  multiUndo: (box: "source" | "reference") => void;
  multiRedo: (box: "source" | "reference") => void;

  setImage: (box: "result", img: UploadedImage, label?: string) => void;
  clearBox: (box: "result") => void;
  boxUndo: (box: "result") => void;
  boxRedo: (box: "result") => void;

  setZoom: (box: ComposerBox, z: number) => void;
  setPan: (box: ComposerBox, pan: { x: number; y: number }) => void;

  togglePose: (id: string) => void;
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

export const useComposerStore = create<ComposerState>()(
  persist(
    (set, get) => {
      const patchMulti = (box: "source" | "reference", patch: Partial<MultiBoxState>) =>
        set((s) => ({ ...s, [box]: { ...s[box], ...patch } }) as Pick<ComposerState, "source" | "reference">);
      const patchBox = (box: "result", patch: Partial<BoxState>) =>
        set((s) => ({ ...s, [box]: { ...s[box], ...patch } }) as Pick<ComposerState, "result">);

      return {
        source: emptyMulti(),
        reference: emptyMulti(),
        result: emptyBox(),
        messages: [
          {
            id: "welcome",
            role: "agent",
            text:
              "مرحبًا 👋 أنا وكيل الدمج الذكي (متعدد).\n" +
              "١. ارفع صور أشخاصك في «المصدر» (يمكن أكثر من صورة) وصور أشخاص آخرين في «المرجع» — أو اذكر اسم شخصية مشهورة في طلبك وسأبحث عنها.\n" +
              "٢. اختر الوضعية (عناق، قبلات، مصافحة...) أو اكتبها بنفسك.\n" +
              "٣. اكتب لي أو تحدث لي — مثال: «اجعلني أصافح الرئيس على شاطئ البحر بملابس البحر».\n" +
              "سأفهم وأحلل ثم أبني الصورة مع قفل ملامح الوجوه الحقيقية لكل شخص، وبعدها عدّل أي منظر تريد.",
            at: Date.now(),
          },
        ],
        poses: [],
        size: "",
        busy: false,
        phase: "",
        progress: 0,
        ttsEnabled: false,
        activeTaskId: null,

        // ---------- المربعات المتعددة ----------
        addItem: (box, img) => {
          const b = get()[box];
          if (b.items.length >= MAX_ITEMS) {
            get().addMessage({ role: "agent", text: `⚠ الحد الأقصى ${MAX_ITEMS} صور في المربع — احذف واحدة أولًا.` });
            return;
          }
          const items = [...b.items, img];
          const past = [...b.history.slice(0, b.idx + 1), items].slice(-MAX_HISTORY);
          patchMulti(box, { items, history: past, idx: past.length - 1, selected: items.length - 1, zoom: 0, pan: { x: 0, y: 0 } });
        },

        removeItem: (box, index) => {
          const b = get()[box];
          if (index < 0 || index >= b.items.length) return;
          const items = b.items.filter((_, i) => i !== index);
          const past = [...b.history.slice(0, b.idx + 1), items].slice(-MAX_HISTORY);
          patchMulti(box, { items, history: past, idx: past.length - 1, selected: Math.min(b.selected, Math.max(0, items.length - 1)), zoom: 0, pan: { x: 0, y: 0 } });
        },

        selectItem: (box, index) => patchMulti(box, { selected: Math.max(0, index) }),

        replaceItem: (box, index, img) => {
          const b = get()[box];
          if (index < 0 || index >= b.items.length) return;
          const items = b.items.map((it, i) => (i === index ? img : it));
          const past = [...b.history.slice(0, b.idx + 1), items].slice(-MAX_HISTORY);
          patchMulti(box, { items, history: past, idx: past.length - 1, selected: index, zoom: 0, pan: { x: 0, y: 0 } });
        },

        clearMultiBox: (box) => {
          const b = get()[box];
          const past = [...b.history.slice(0, b.idx + 1), []].slice(-MAX_HISTORY);
          patchMulti(box, { items: [], history: past, idx: past.length - 1, selected: 0, zoom: 0, pan: { x: 0, y: 0 } });
        },

        multiUndo: (box) => {
          const b = get()[box];
          if (b.idx <= 0) return;
          const idx = b.idx - 1;
          patchMulti(box, { idx, items: b.history[idx] ?? [], selected: 0, zoom: 0, pan: { x: 0, y: 0 } });
        },

        multiRedo: (box) => {
          const b = get()[box];
          if (b.idx >= b.history.length - 1) return;
          const idx = b.idx + 1;
          patchMulti(box, { idx, items: b.history[idx] ?? [], selected: 0, zoom: 0, pan: { x: 0, y: 0 } });
        },

        // ---------- مربع النتيجة (فردي كما كان) ----------
        setImage: (box, img, label) => {
          const b = get()[box];
          const past = [...b.history.slice(0, b.idx + 1), img].slice(-MAX_HISTORY);
          patchBox(box, { img, history: past, idx: past.length - 1, zoom: 0, pan: { x: 0, y: 0 } });
          if (label) console.debug(`[composer] ${box} ← ${label}`);
        },

        clearBox: (box) => {
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
          if (box === "result") {
            patchBox(box, { zoom: clamped, pan: clamped === 0 ? { x: 0, y: 0 } : get()[box].pan });
          } else {
            patchMulti(box as "source" | "reference", { zoom: clamped, pan: clamped === 0 ? { x: 0, y: 0 } : get()[box].pan });
          }
        },

        setPan: (box, pan) => {
          if (box === "result") patchBox(box, { pan });
          else patchMulti(box as "source" | "reference", { pan });
        },

        // ---------- الوضعيات ----------
        togglePose: (id) =>
          set((s) => ({
            poses: s.poses.includes(id) ? s.poses.filter((p) => p !== id) : [...s.poses, id],
          })),

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
        resetAll: () =>
          set({
            source: emptyMulti(),
            reference: emptyMulti(),
            result: emptyBox(),
            messages: [],
            poses: [],
            size: "",
            busy: false,
            phase: "",
            progress: 0,
            activeTaskId: null,
          }),
      };
    },
    {
      name: "content-composer-store",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // نحفظ الصور والرسائل والمقاس والوضعيات حتى لا يفقد المستخدم عمله عند
      // إعادة تحميل الصفحة أو التنقل بين التبويبات (نفس أسلوب متجر الاستوديو).
      // busy/phase/progress/activeTaskId لا تُحفظ — مهام عابرة.
      partialize: (s) => ({
        source: s.source,
        reference: s.reference,
        result: s.result,
        messages: s.messages.slice(-40),
        poses: s.poses,
        size: s.size,
        ttsEnabled: s.ttsEnabled,
      }),
      // ترحيل الحالة القديمة (v1: مربعات فردية img) إلى الشكل المتعدد
      migrate: (persisted: any) => {
        try {
          const conv = (b: any): MultiBoxState => {
            if (b && Array.isArray(b.items)) {
              return { items: b.items, history: Array.isArray(b.history) ? b.history : [b.items], idx: b.idx ?? 0, selected: b.selected ?? 0, zoom: b.zoom ?? 0, pan: b.pan ?? { x: 0, y: 0 } };
            }
            if (b && b.img) return { items: [b.img], history: [[b.img]], idx: 0, selected: 0, zoom: 0, pan: { x: 0, y: 0 } };
            return emptyMulti();
          };
          return {
            ...persisted,
            source: conv(persisted?.source),
            reference: conv(persisted?.reference),
          } as any;
        } catch {
          return persisted as any;
        }
      },
    }
  )
);

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
