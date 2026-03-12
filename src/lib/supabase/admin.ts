import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createPlaywrightStubSupabaseClient,
  isPlaywrightSupabaseStubMode,
} from "@/lib/supabase/playwright-stub";

/**
 * Service-role Supabase client for server-only operations.
 * Bypasses RLS — use only in API routes/server actions.
 *
 * On Cloudflare Workers, process.env may be populated per-request
 * via the env binding, so we cache keyed by URL+key to avoid stale singletons.
 */
let adminInstance: SupabaseClient | null = null;
let cachedUrl: string | null = null;
let cachedKey: string | null = null;

export function createAdminClient(): SupabaseClient {
  if (isPlaywrightSupabaseStubMode()) {
    return createPlaywrightStubSupabaseClient() as unknown as SupabaseClient;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase admin credentials: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  }

  // Re-create client if credentials changed (handles Cloudflare Worker isolate reuse)
  if (adminInstance && cachedUrl === url && cachedKey === key) {
    return adminInstance;
  }

  adminInstance = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  cachedUrl = url;
  cachedKey = key;
  return adminInstance;
}
