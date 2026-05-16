import { createBrowserClient } from "@supabase/ssr";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { getPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { getStablePlanId } from "@/lib/constants/plan-ids";
import { PLANS, isActiveMarketplaceArea } from "@/lib/constants/pricing";
import { isPlaywrightSupabaseStubMode } from "@/lib/supabase/playwright-mode";
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

const PLAYWRIGHT_SESSION_PREFIX = "persona:";

function decodePlaywrightPersonaFromCookie(token: string | null): string | null {
  const normalizedToken = token ? decodeURIComponent(token) : null;

  if (!normalizedToken?.startsWith(PLAYWRIGHT_SESSION_PREFIX)) {
    return null;
  }

  try {
    return decodeURIComponent(normalizedToken.slice(PLAYWRIGHT_SESSION_PREFIX.length));
  } catch {
    return null;
  }
}

function getBrowserCookie(name: string): string | null {
  if (typeof document === "undefined") return null;

  const prefix = `${name}=`;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return cookie ? cookie.slice(prefix.length) : null;
}

function setBrowserCookie(name: string, value: string) {
  if (typeof document === "undefined") return;
  const secure = globalThis.location?.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; path=/; SameSite=Lax${secure}`;
}

function removeBrowserCookie(name: string) {
  if (typeof document === "undefined") return;
  const secure = globalThis.location?.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax${secure}`;
}

function createBrowserPlaywrightStubClient(): SupabaseClient {
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();

  function readUser() {
    const persona = decodePlaywrightPersonaFromCookie(getBrowserCookie("vmz_pw_session"));

    if (!persona) {
      return null;
    }

    return {
      id: `pw-${persona}`,
      email: `${persona}@playwright.verifymzansi.test`,
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      is_anonymous: false,
      app_metadata: { role: "member" },
      user_metadata: { display_name: `Playwright ${persona}` },
      identities: [{ id: `pw-identity-${persona}` }],
    };
  }

  function readSession(): Session | null {
    const token = getBrowserCookie("vmz_pw_session");
    const user = readUser();
    if (!token || !user) return null;

    return {
      access_token: token,
      refresh_token: token,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    } as unknown as Session;
  }

  function emit(event: AuthChangeEvent, session: Session | null) {
    for (const listener of listeners) {
      listener(event, session);
    }
  }

  async function readFixtureRow(table: string, id: unknown) {
    if (typeof id !== "string") {
      return { data: null, error: null };
    }

    const response = await fetch(`/api/e2e/${table}/${id}`, {
      credentials: "same-origin",
      cache: "no-store",
    });

    if (!response.ok) {
      return { data: null, error: null };
    }

    const payload = (await response.json()) as { data?: unknown; error?: unknown };
    return { data: payload.data ?? null, error: payload.error ?? null };
  }

  function createQuery(table: string) {
    const state: { filters: Array<{ column: string; value: unknown }> } = { filters: [] };

    function readFilter(column: string) {
      return state.filters.find((filter) => filter.column === column)?.value;
    }

    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        state.filters.push({ column, value });
        return builder;
      },
      single: async () => {
        const user = readUser();

        if (table === "account_profiles" && user && readFilter("user_id") === user.id) {
          return {
            data: {
              id: `pw-profile-${user.id}`,
              user_id: user.id,
              display_name: user.user_metadata.display_name,
              account_verification_status: "verified",
              account_status: "active",
              strikes: 0,
              legal_hold: false,
            },
            error: null,
          };
        }

        if (table === "plans") {
          const area = readFilter("area");
          const tier = readFilter("tier");
          const active = readFilter("active");
          const plan = PLANS.find(
            (candidate) =>
              candidate.area === area &&
              candidate.tier === tier &&
              (active === undefined || isActiveMarketplaceArea(candidate.area) === active)
          );

          if (!plan) {
            return { data: null, error: null };
          }

          return {
            data: {
              id: getStablePlanId(plan.area, plan.tier),
              area: plan.area,
              tier: plan.tier,
              active: isActiveMarketplaceArea(plan.area),
            },
            error: null,
          };
        }

        if (table === "listings" && readFilter("id")) {
          return readFixtureRow("listings", readFilter("id"));
        }

        return { data: null, error: null };
      },
      order: () => builder,
      in: () => builder,
      maybeSingle: async () => {
        if (table === "listings" && readFilter("id")) {
          return readFixtureRow("listings", readFilter("id"));
        }

        return { data: null, error: null };
      },
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve(resolve({ data: [], error: null })),
    };

    return builder;
  }

  return {
    auth: {
      getUser: async () => ({ data: { user: readUser() }, error: null }),
      getSession: async () => ({ data: { session: readSession() }, error: null }),
      signOut: async () => {
        removeBrowserCookie("vmz_pw_session");
        emit("SIGNED_OUT", null);
        return { error: null };
      },
      onAuthStateChange: (callback: (event: AuthChangeEvent, session: Session | null) => void) => {
        listeners.add(callback);
        return {
          data: {
            subscription: {
              unsubscribe() {
                listeners.delete(callback);
              },
            },
          },
        };
      },
      signInWithPassword: async (credentials: { email: string; password: string }) => {
        const persona = credentials.email.split("@")[0] || "member";
        const token = `${PLAYWRIGHT_SESSION_PREFIX}${encodeURIComponent(persona)}`;
        setBrowserCookie("vmz_pw_session", token);
        const session = readSession();
        emit("SIGNED_IN", session);
        return { data: { user: readUser(), session }, error: null };
      },
    },
    from: (table: string) => createQuery(table),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  } as unknown as SupabaseClient;
}

/**
 * Create (or return the cached) Supabase client for use in Client Components.
 * The client is a singleton — safe to call repeatedly without causing
 * unnecessary re-renders or re-subscriptions.
 *
 * @supabase/ssr stores the browser session in cookies so the server
 * middleware and Client Components can agree on the current user.
 */
export function createClient(): SupabaseClient {
  if (_client) return _client;

  if (isPlaywrightSupabaseStubMode()) {
    _client = createBrowserPlaywrightStubClient();
    return _client;
  }

  const { supabaseUrl: url, supabaseAnonKey: anonKey } = getPublicRuntimeConfig();
  const validUrl = typeof url === "string" && isValidHttpUrl(url);
  const hasAnonKey = typeof anonKey === "string" && anonKey.length > 0;

  if (!validUrl || !hasAnonKey) {
    // In production, fail loudly so the issue is surfaced immediately
    // instead of letting users see a broken UI with no explanation.
    if (typeof window !== "undefined" && process.env.NODE_ENV === "production") {
      log.error(
        "Missing or invalid NEXT_PUBLIC_SUPABASE_* env values. Auth and data features will not work."
      );
      // Surface a visible console error so devtools catches it immediately
      console.error(
        "[VerifyMzansi] CRITICAL: Supabase is not configured. Authentication is unavailable."
      );
    } else if (typeof window !== "undefined") {
      log.error(
        "Missing or invalid NEXT_PUBLIC_SUPABASE_* env values. Auth and data features will not work."
      );
    } else if (process.env.NODE_ENV !== "production") {
      log.warn("Falling back to placeholder browser client during SSR due to missing env values.");
    }
    _client = createPlaceholderClient();
    return _client;
  }

  _client = createBrowserClient(url, anonKey) as SupabaseClient;

  return _client;
}
