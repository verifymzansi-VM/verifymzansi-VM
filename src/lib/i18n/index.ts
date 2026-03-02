import type enMessages from "./messages/en.json";

/** Supported locales */
export const locales = ["en", "zu", "af"] as const;
export type Locale = (typeof locales)[number];

/** Human-readable locale labels */
export const localeLabels: Record<Locale, string> = {
  en: "English",
  zu: "isiZulu",
  af: "Afrikaans",
};

/** Default / fallback locale */
export const defaultLocale: Locale = "en";

/** Flat nested-key type for strongly-typed translations */
export type Messages = typeof enMessages;

type FlattenKeys<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: FlattenKeys<T[K], Prefix extends "" ? K : `${Prefix}.${K}`>;
    }[keyof T & string]
  : Prefix;

export type MessageKey = FlattenKeys<Messages>;

/** Lazy-load message bundles to keep the initial bundle small. */
const messageLoaders: Record<Locale, () => Promise<Messages>> = {
  en: () => import("./messages/en.json").then((m) => m.default),
  zu: () => import("./messages/zu.json").then((m) => m.default),
  af: () => import("./messages/af.json").then((m) => m.default),
};

const messageCache = new Map<Locale, Messages>();

/**
 * Load messages for a locale (cached after first load).
 */
export async function loadMessages(locale: Locale): Promise<Messages> {
  const cached = messageCache.get(locale);
  if (cached) return cached;

  const messages = await messageLoaders[locale]();
  messageCache.set(locale, messages);
  return messages;
}

/**
 * Resolve a dot-separated key (e.g. "common.signIn") against a messages object.
 */
export function resolveKey(
  messages: Messages,
  key: string,
  params?: Record<string, string | number>
): string {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let value: any = messages;

  for (const part of parts) {
    if (value == null || typeof value !== "object") return key;
    value = value[part as keyof typeof value];
  }

  if (typeof value !== "string") {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[i18n] Missing translation key: "${key}"`);
    }
    return key;
  }

  // Simple interpolation: "Hello {name}" → "Hello World"
  if (params) {
    return value.replace(/\{(\w+)\}/g, (_, k: string) =>
      params[k] != null ? String(params[k]) : `{${k}}`
    );
  }

  return value;
}
