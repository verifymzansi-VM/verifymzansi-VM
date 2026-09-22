"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAuthStore } from "@/stores/auth-store";
import {
  ACCOUNT_PROFILE_WRITE_TABLE,
  normalizeUserRole,
  readAccountVerificationStatus,
} from "@/lib/account/compat";
import { isPlaywrightSupabaseStubMode } from "@/lib/supabase/playwright-mode";
import { createLogger } from "@/lib/utils/logger";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";

const log = createLogger("useAuth");
const PROFILE_FETCH_RETRY_DELAYS_MS = [150, 400] as const;

/**
 * The Supabase browser client pulls in ~177 KB (uncompressed) of auth,
 * PostgREST, and realtime code. Most page views are anonymous visitors on
 * public pages, so the client bundle is loaded on demand instead of eagerly:
 * visitors without a Supabase session cookie skip the download entirely.
 */
let supabaseClientPromise: Promise<SupabaseClient> | null = null;

function getSupabaseClient(): Promise<SupabaseClient> {
  if (!supabaseClientPromise) {
    supabaseClientPromise = import("@/lib/supabase/client")
      .then((mod) => mod.createClient())
      .catch((err) => {
        // Reset so the next attempt retries the download (transient network
        // failure or a chunk mismatch after a deploy) instead of latching
        // onto a permanently rejected promise.
        supabaseClientPromise = null;
        throw err;
      });
  }
  return supabaseClientPromise;
}

// @supabase/ssr stores the browser session in cookies named
// `sb-<project-ref>-auth-token` (chunked as `-auth-token.0`, `.1`, ... when large).
const SUPABASE_AUTH_COOKIE_PATTERN = /(?:^|;\s*)sb-[^=;\s]*-auth-token(\.\d+)?=/;
const PLAYWRIGHT_SESSION_COOKIE_NAME = "vmz_pw_session";

/**
 * Cheap pre-flight check for a persisted auth session. Anonymous visitors get
 * a signed-out state immediately without paying for the Supabase bundle or a
 * network round-trip. Signed-in flows always navigate to a fresh page (the
 * App Router template remounts page components), so the cookie is re-checked
 * on every navigation.
 */
export function hasBrowserAuthSession(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  if (isPlaywrightSupabaseStubMode()) {
    return document.cookie.includes(`${PLAYWRIGHT_SESSION_COOKIE_NAME}=`);
  }

  return SUPABASE_AUTH_COOKIE_PATTERN.test(document.cookie);
}

/**
 * Hook providing current auth user, profile, role, and loading state.
 * Automatically syncs with Supabase auth state.
 */
export function useAuth() {
  const { user, profile, trustLevel, isLoading, setUser, setProfile, setLoading, reset } =
    useAuthStore();

  const fetchedRef = useRef(false);

  function readSessionRole(role: unknown): string {
    if (typeof role !== "string") {
      return "user";
    }

    return normalizeUserRole(role) ?? role;
  }

  function readSessionDisplayName(userMetadata: unknown, email: string | undefined): string {
    const metadata =
      userMetadata && typeof userMetadata === "object"
        ? (userMetadata as Record<string, unknown>)
        : null;

    const readName = (...keys: string[]) => {
      for (const key of keys) {
        const value = metadata?.[key];
        if (typeof value === "string" && value.trim().length > 0) {
          return value.trim();
        }
      }
      return "";
    };

    const directName = readName("display_name", "full_name", "name");
    if (directName) {
      return directName;
    }

    const combinedName = [readName("given_name"), readName("family_name")]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (combinedName) {
      return combinedName;
    }

    return email?.split("@")[0] || "User";
  }

  const fetchAccountProfileWithRetry = useCallback(
    async (supabase: SupabaseClient, userId: string) => {
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= PROFILE_FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
        const { data, error } = await supabase
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .select("*")
          .eq("user_id", userId)
          .maybeSingle();

        if (!error && data) {
          return data;
        }

        // No row yet — for OAuth signups the profile may be created
        // asynchronously by a trigger, so retry before giving up.
        if (!error && !data) {
          const isLastAttempt = attempt === PROFILE_FETCH_RETRY_DELAYS_MS.length;
          if (isLastAttempt) {
            return null;
          }
          await new Promise((resolve) => {
            setTimeout(resolve, PROFILE_FETCH_RETRY_DELAYS_MS[attempt]);
          });
          continue;
        }

        lastError = error;
        const isLastAttempt = attempt === PROFILE_FETCH_RETRY_DELAYS_MS.length;
        if (isLastAttempt) {
          break;
        }

        await new Promise((resolve) => {
          setTimeout(resolve, PROFILE_FETCH_RETRY_DELAYS_MS[attempt]);
        });
      }

      throw lastError;
    },
    []
  );

  const fetchUser = useCallback(
    async (options?: { force?: boolean }) => {
      // Guard: skip if we already fetched during this component lifecycle.
      // The Zustand store is shared, so other useAuth() consumers see the
      // same data without triggering duplicate Supabase round-trips.
      if (fetchedRef.current && !options?.force) return;
      fetchedRef.current = true;

      // Anonymous fast path: no persisted session cookie means no user, so
      // skip loading the Supabase bundle and the network round-trip.
      if (!hasBrowserAuthSession()) {
        reset();
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const supabase = await getSupabaseClient();
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();

        if (!authUser) {
          reset();
          return;
        }

        setUser({
          id: authUser.id,
          email: authUser.email || "",
          displayName: readSessionDisplayName(authUser.user_metadata, authUser.email),
          role: readSessionRole(authUser.app_metadata?.role),
        });

        try {
          const accountProfile = await fetchAccountProfileWithRetry(supabase, authUser.id);

          if (accountProfile) {
            setProfile(accountProfile);
          } else {
            setProfile(null);
          }
        } catch (profileError) {
          setProfile(null);
          log.warn("Failed to fetch account profile after retries", {
            userId: authUser.id,
            error: profileError instanceof Error ? profileError.message : String(profileError),
          });
        }
      } catch (err) {
        log.error("Failed to fetch user", {
          error: err instanceof Error ? err.message : String(err),
        });
        reset();
      } finally {
        setLoading(false);
      }
    },
    [fetchAccountProfileWithRetry, reset, setLoading, setProfile, setUser]
  );

  useEffect(() => {
    void fetchUser();

    // Anonymous visitors have no session to observe — skip the Supabase
    // bundle download and auth-state subscription entirely.
    if (!hasBrowserAuthSession()) {
      return;
    }

    let cancelled = false;
    let subscription: { unsubscribe: () => void } | null = null;

    // Subscribe to auth state changes (session refresh, sign-out in other tabs, etc.)
    void getSupabaseClient().then((supabase) => {
      if (cancelled) return;
      const { data } = supabase.auth.onAuthStateChange(
        (event: AuthChangeEvent, session: Session | null) => {
          if (session?.user) {
            void fetchUser({ force: true });
          } else {
            // If user was previously authenticated and session was lost, reset store.
            // Don't redirect here — let signOut() or middleware handle navigation
            // to avoid race conditions with the explicit signOut callback.
            reset();
          }
        }
      );
      subscription = data.subscription;
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
    // `user` is intentionally excluded — including it would cause re-subscription
    // on every state change. The SIGNED_OUT redirect reads `user` from closure.
  }, [fetchUser, reset]);

  const signOut = useCallback(async () => {
    try {
      const supabase = await getSupabaseClient();
      await supabase.auth.signOut();
    } catch (err) {
      log.error("Sign-out failed", { error: err instanceof Error ? err.message : String(err) });
    }
    reset();
    // Clear notification store to prevent cross-account data leak
    const { clearAll: clearNotifications } = (
      await import("@/stores/notification-store")
    ).useNotificationStore.getState();
    clearNotifications();
    // Clear the phone-gate cookie client-side (server sign-out route also
    // does this, but the client hook may be used directly).
    document.cookie = "x-phone-ok=; path=/; max-age=0";
    window.location.assign(new URL("/", window.location.origin).toString());
  }, [reset]);

  const isAuthenticated = !!user;
  const isAdmin = user?.role === "admin";
  const isModerator = user?.role === "moderator" || isAdmin;
  const isVerified = readAccountVerificationStatus(profile) === "verified";

  return {
    user,
    profile,
    trustLevel,
    isLoading,
    isAuthenticated,
    isAdmin,
    isModerator,
    isVerified,
    signOut,
    refresh: () => fetchUser({ force: true }),
  };
}
