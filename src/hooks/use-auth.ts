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
import { toast } from "@/hooks/use-toast";
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
// All hook consumers write to the same store. A newer session lookup or
// sign-out must invalidate older requests across consumers, not only one hook.
let authRequestVersion = 0;

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
 * Signs the browser session out and clears every piece of client state tied
 * to the account (auth store, notification store, phone-gate cookie) before a
 * hard navigation home. Every sign-out control must go through this so a
 * failed sign-out never looks successful and a successful one never leaves
 * the previous account's data in memory. Resolves `false` (after showing a
 * toast) when the provider rejects the sign-out; the session is kept intact.
 */
export async function signOutBrowserSession(): Promise<boolean> {
  try {
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (err) {
    log.error("Sign-out failed", { error: err instanceof Error ? err.message : String(err) });
    toast({
      title: "Could not sign out",
      description: "Please try again.",
      variant: "destructive",
    });
    return false;
  }
  await clearClientAccountState();
  window.location.assign(new URL("/", window.location.origin).toString());
  return true;
}

/**
 * Drops every piece of in-memory/client state tied to the current account
 * (auth store, notification store, phone-gate cookie). Call this whenever the
 * account's session ends — sign-out, account deletion — before navigating
 * away, so the previous account's data can never be shown to the next user.
 */
export async function clearClientAccountState(): Promise<void> {
  authRequestVersion += 1;
  useAuthStore.getState().reset();
  // Clear notification store to prevent cross-account data leak
  const { clearAll: clearNotifications } = (
    await import("@/stores/notification-store")
  ).useNotificationStore.getState();
  clearNotifications();
  // Clear the phone-gate cookie client-side (server sign-out route also
  // does this, but the client hook may be used directly).
  document.cookie = "x-phone-ok=; path=/; max-age=0";
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
      const requestVersion = ++authRequestVersion;
      const isCurrentRequest = () => requestVersion === authRequestVersion;

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
        if (!isCurrentRequest()) return;
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (!isCurrentRequest()) return;

        if (!authUser) {
          reset();
          return;
        }

        if (useAuthStore.getState().user?.id !== authUser.id) {
          setProfile(null);
          useAuthStore.getState().setTrustLevel(0);
        }
        setUser({
          id: authUser.id,
          email: authUser.email || "",
          displayName: readSessionDisplayName(authUser.user_metadata, authUser.email),
          role: readSessionRole(authUser.app_metadata?.role),
        });

        try {
          const accountProfile = await fetchAccountProfileWithRetry(supabase, authUser.id);
          if (!isCurrentRequest()) return;

          if (accountProfile) {
            setProfile(accountProfile);
          } else {
            setProfile(null);
          }
        } catch (profileError) {
          if (!isCurrentRequest()) return;
          setProfile(null);
          log.warn("Failed to fetch account profile after retries", {
            userId: authUser.id,
            error: profileError instanceof Error ? profileError.message : String(profileError),
          });
        }
      } catch (err) {
        if (!isCurrentRequest()) return;
        log.error("Failed to fetch user", {
          error: err instanceof Error ? err.message : String(err),
        });
        reset();
      } finally {
        if (isCurrentRequest()) setLoading(false);
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
    void getSupabaseClient()
      .then((supabase) => {
        if (cancelled) return;
        const { data } = supabase.auth.onAuthStateChange(
          (event: AuthChangeEvent, session: Session | null) => {
            if (session?.user) {
              void fetchUser({ force: true });
            } else {
              // If user was previously authenticated and session was lost, reset store.
              // Don't redirect here — let signOut() or middleware handle navigation
              // to avoid race conditions with the explicit signOut callback.
              authRequestVersion += 1;
              reset();
            }
          }
        );
        subscription = data.subscription;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        log.warn("Failed to subscribe to auth state", {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
    // `user` is intentionally excluded — including it would cause re-subscription
    // on every state change. The SIGNED_OUT redirect reads `user` from closure.
  }, [fetchUser, reset]);

  const signOut = useCallback(() => signOutBrowserSession(), []);

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
