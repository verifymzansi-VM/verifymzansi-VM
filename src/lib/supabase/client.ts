import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { isPlaywrightSupabaseStubMode } from "@/lib/supabase/playwright-stub";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("SupabaseClient");
let _client: SupabaseClient | null = null;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function createPlaceholderClient() {
  return createBrowserClient("https://placeholder.supabase.co", "placeholder", {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as SupabaseClient;
}

/**
 * Create (or return the cached) Supabase client for use in Client Components.
 * The client is a singleton — safe to call repeatedly without causing
 * unnecessary re-renders or re-subscriptions.
 *
 * Session persistence, auto-refresh, and URL detection are disabled
 * because auth state is managed server-side via proxy cookies.
 */
export function createClient(): SupabaseClient {
  if (_client) return _client;

  if (isPlaywrightSupabaseStubMode()) {
    _client = createPlaceholderClient();
    return _client;
  }

  const { supabaseUrl: url, supabaseAnonKey: anonKey } = getPublicRuntimeConfig();
  const validUrl = typeof url === "string" && isValidHttpUrl(url);
  const hasAnonKey = typeof anonKey === "string" && anonKey.length > 0;

  if (!validUrl || !hasAnonKey) {
    // Gracefully degrade instead of crashing the entire app.
    // Auth and data features will be unavailable but the UI remains usable.
    if (typeof window !== "undefined") {
      log.error(
        "Missing or invalid NEXT_PUBLIC_SUPABASE_* env values. Auth and data features will not work."
      );
    } else if (process.env.NODE_ENV !== "production") {
      log.warn("Falling back to placeholder browser client during SSR due to missing env values.");
    }
    _client = createPlaceholderClient();
    return _client;
  }

  _client = createBrowserClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }) as SupabaseClient;

  return _client;
}
