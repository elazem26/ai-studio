"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import ar from "./ar.json";
import en from "./en.json";

export type Locale = "ar" | "en";
type Dict = typeof ar;

const dictionaries: Record<Locale, Dict> = { ar, en };

/** Deeply nested key path like "panels.source.title" */
export type TranslationKey = string;

function lookup(dict: Dict, key: TranslationKey): string {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === "string" ? cur : key;
}

interface I18nState {
  locale: Locale;
  dir: "rtl" | "ltr";
  setLocale: (l: Locale) => void;
  toggle: () => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function translate(locale: Locale, key: TranslationKey, params?: Record<string, string | number>): string {
  let str = lookup(dictionaries[locale], key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return str;
}

export const useI18n = create<I18nState>()(
  persist(
    (set, get) => ({
      locale: "ar",
      dir: "rtl",
      setLocale: (l) => set({ locale: l, dir: l === "ar" ? "rtl" : "ltr" }),
      toggle: () =>
        set((s) => {
          const next: Locale = s.locale === "ar" ? "en" : "ar";
          return { locale: next, dir: next === "ar" ? "rtl" : "ltr" };
        }),
      // The translate function reads `get().locale` at call time, so it
      // always returns the correct language for the *current* store state.
      // The catch: components must subscribe to `locale` too so they
      // re-render when language changes (see `useT` below).
      t: (key, params) => translate(get().locale, key, params),
    }),
    {
      name: "ai-studio-i18n",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/**
 * Convenience hook: returns the translate function bound to the current
 * locale. Components using this will re-render when locale changes
 * because we subscribe to `locale` as a dependency.
 */
export function useT() {
  const locale = useI18n((s) => s.locale);
  const dir = useI18n((s) => s.dir);
  const t = (key: TranslationKey, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  return { t, locale, dir };
}
