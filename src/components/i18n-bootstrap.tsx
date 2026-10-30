"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * Syncs <html lang> and <html dir> with the user's locale preference.
 * Also injects the persisted dark/light class on first paint to prevent
 * FOUC (flash of unstyled content).
 */
export function I18nBootstrap() {
  const locale = useI18n((s) => s.locale);
  const dir = useI18n((s) => s.dir);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  return null;
}
