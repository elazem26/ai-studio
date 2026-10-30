"use client";
import { create } from "zustand";
interface HistoryEntry<T = unknown> { id: string; label: string; state: T; at: number; }
interface SectionHistory { past: HistoryEntry[]; future: HistoryEntry[]; }
interface UndoRedoState {
  sections: Record<string, SectionHistory>;
  pushHistory: (sectionId: string, label: string, state: unknown) => void;
  undo: (sectionId: string) => HistoryEntry | null;
  redo: (sectionId: string) => HistoryEntry | null;
  canUndo: (sectionId: string) => boolean;
  canRedo: (sectionId: string) => boolean;
  current: (sectionId: string) => HistoryEntry | null;
  clear: (sectionId: string) => void;
  resetAll: () => void;
}
const MAX_HISTORY = 50;
export const useUndoRedoStore = create<UndoRedoState>((set, get) => ({
  sections: {},
  pushHistory: (sectionId, label, state) => set((s) => {
    const sec = s.sections[sectionId] ?? { past: [], future: [] };
    const entry: HistoryEntry = { id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label, state, at: Date.now() };
    const past = [...sec.past, entry].slice(-MAX_HISTORY);
    return { sections: { ...s.sections, [sectionId]: { past, future: [] } } };
  }),
  undo: (sectionId) => {
    const sec = get().sections[sectionId];
    if (!sec || sec.past.length === 0) return null;
    const past = [...sec.past];
    const entry = past.pop()!;
    const future = [entry, ...sec.future].slice(0, MAX_HISTORY);
    set((s) => ({ sections: { ...s.sections, [sectionId]: { past, future } } }));
    return past[past.length - 1] ?? entry;
  },
  redo: (sectionId) => {
    const sec = get().sections[sectionId];
    if (!sec || sec.future.length === 0) return null;
    const future = [...sec.future];
    const entry = future.shift()!;
    const past = [...sec.past, entry].slice(-MAX_HISTORY);
    set((s) => ({ sections: { ...s.sections, [sectionId]: { past, future } } }));
    return entry;
  },
  canUndo: (sectionId) => { const sec = get().sections[sectionId]; return !!sec && sec.past.length > 0; },
  canRedo: (sectionId) => { const sec = get().sections[sectionId]; return !!sec && sec.future.length > 0; },
  current: (sectionId) => { const sec = get().sections[sectionId]; if (!sec || sec.past.length === 0) return null; return sec.past[sec.past.length - 1]; },
  clear: (sectionId) => set((s) => { const next = { ...s.sections }; delete next[sectionId]; return { sections: next }; }),
  resetAll: () => set({ sections: {} }),
}));
