"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Locale, type Messages, defaultLocale, loadMessages, resolveKey } from "@/lib/i18n";

interface I18nState {
  locale: Locale;
  messages: Messages | null;
  isLoading: boolean;
  setLocale: (locale: Locale) => Promise<void>;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set, get) => ({
      locale: defaultLocale,
      messages: null,
      isLoading: false,

      async setLocale(locale: Locale) {
        if (locale === get().locale && get().messages) return;
        set({ isLoading: true, locale });

        const messages = await loadMessages(locale);
        set({ messages, isLoading: false });

        // Update <html lang="..."> attribute for a11y / SEO
        if (typeof document !== "undefined") {
          document.documentElement.lang = locale;
        }
      },
    }),
    {
      name: "verifymzansi-locale",
      // Only persist the locale choice, not the full messages bundle
      partialize: (state) => ({ locale: state.locale }),
    }
  )
);

/**
 * Hook: returns a `t()` function for the current locale.
 *
 * Usage:
 * ```tsx
 * const { t, locale, setLocale, isLoading } = useTranslation();
 * return <h1>{t("common.tagline")}</h1>;
 * ```
 */
export function useTranslation() {
  const { locale, messages, isLoading, setLocale } = useI18nStore();

  // Auto-load messages on first render if they haven't been loaded yet
  useEffect(() => {
    if (!messages && !isLoading) {
      setLocale(locale);
    }
  }, [locale, messages, isLoading, setLocale]);

  function t(key: string, params?: Record<string, string | number>): string {
    if (!messages) return key;
    return resolveKey(messages, key, params);
  }

  return { t, locale, setLocale, isLoading } as const;
}
