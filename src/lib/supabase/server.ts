import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createPlaywrightStubSupabaseClient } from "@/lib/supabase/playwright-stub";
import { isPlaywrightSupabaseStubMode } from "@/lib/supabase/playwright-mode";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Supabase");

/**
 * Create a Supabase client for use in Server Components and Route Handlers.
 * Reads/writes auth cookies via the Next.js `cookies()` API.
 */
export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  if (isPlaywrightSupabaseStubMode()) {
    return createPlaywrightStubSupabaseClient({
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options?: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {}
        },
        remove(name: string, options?: CookieOptions) {
          try {
            cookieStore.set({ name, value: "", ...options });
          } catch {}
        },
      },
    }) as unknown as SupabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase server credentials: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set"
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch (e) {
          // The `set` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing sessions.
          if (process.env.NODE_ENV === "development") {
            logger.warn(`Cookie set failed for "${name}"`, { error: String(e) });
          }
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch (e) {
          if (process.env.NODE_ENV === "development") {
            logger.warn(`Cookie remove failed for "${name}"`, { error: String(e) });
          }
        }
      },
    },
  }) as unknown as SupabaseClient;
}
