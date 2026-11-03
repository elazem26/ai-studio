"use client";
import { create } from "zustand";
interface HistoryEntry<T = unknown> { id: string; label: string; state: T; at: number; }
interface SectionHistory { past: HistoryEntry[]; future: HistoryEntry[]; }
interface UndoRedoState {
  sections: Record<string, SectionHistory>;
  pushHistory: (sectionId: string, label: string, state: unknown) => void;
  /**
   * `currentState` = the LIVE state at the moment of undoing. It is pushed
   * onto `future` so Redo can rebuild the newest state. Sections that push
   * POST-action snapshots (image-tools) may omit it — their snapshots
   * already include the newest state.
   */
  undo: (sectionId: string, currentState?: unknown) => HistoryEntry | null;
  redo: (sectionId: string, currentState?: unknown) => HistoryEntry | null;
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
  undo: (sectionId, currentState) => {
    const sec = get().sections[sectionId];
    if (!sec || sec.past.length === 0) return null;
    const past = [...sec.past];
    const entry = past.pop()!;
    const liveEntry: HistoryEntry | null =
      currentState === undefined
        ? null
        : {
            id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            label: "current",
            state: currentState,
            at: Date.now(),
          };
    const future = (
      liveEntry ? [liveEntry, ...sec.future] : sec.future
    ).slice(0, MAX_HISTORY);
    set((s) => ({ sections: { ...s.sections, [sectionId]: { past, future } } }));
    return entry;
  },
  redo: (sectionId, currentState) => {
    const sec = get().sections[sectionId];
    if (!sec || sec.future.length === 0) return null;
    const future = [...sec.future];
    const entry = future.shift()!;
    const liveEntry: HistoryEntry | null =
      currentState === undefined
        ? null
        : {
            id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            label: "current",
            state: currentState,
            at: Date.now(),
          };
    const past = (
      liveEntry ? [...sec.past, liveEntry] : sec.past
    ).slice(-MAX_HISTORY);
    set((s) => ({ sections: { ...s.sections, [sectionId]: { past, future } } }));
    return entry;
  },
  canUndo: (sectionId) => { const sec = get().sections[sectionId]; return !!sec && sec.past.length > 0; },
  canRedo: (sectionId) => { const sec = get().sections[sectionId]; return !!sec && sec.future.length > 0; },
  current: (sectionId) => { const sec = get().sections[sectionId]; if (!sec || sec.past.length === 0) return null; return sec.past[sec.past.length - 1]; },
  clear: (sectionId) => set((s) => { const next = { ...s.sections }; delete next[sectionId]; return { sections: next }; }),
  resetAll: () => set({ sections: {} }),
}));
