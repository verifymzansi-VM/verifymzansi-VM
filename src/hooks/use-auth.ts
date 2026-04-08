"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAuthStore } from "@/stores/auth-store";
import {
  ACCOUNT_PROFILE_WRITE_TABLE,
  normalizeUserRole,
  readAccountVerificationStatus,
} from "@/lib/account/compat";
import { createClient } from "@/lib/supabase/client";
import { createLogger } from "@/lib/utils/logger";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const log = createLogger("useAuth");
const PROFILE_FETCH_RETRY_DELAYS_MS = [150, 400] as const;

/**
 * Hook providing current auth user, profile, role, and loading state.
 * Automatically syncs with Supabase auth state.
 */
export function useAuth() {
  const { user, profile, trustLevel, isLoading, setUser, setProfile, setLoading, reset } =
    useAuthStore();

  const supabaseRef = useRef(createClient());
  const supabase = supabaseRef.current;
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
    async (userId: string) => {
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
    [supabase]
  );

  const fetchUser = useCallback(
    async (options?: { force?: boolean }) => {
      // Guard: skip if we already fetched during this component lifecycle.
      // The Zustand store is shared, so other useAuth() consumers see the
      // same data without triggering duplicate Supabase round-trips.
      if (fetchedRef.current && !options?.force) return;
      fetchedRef.current = true;

      setLoading(true);
      try {
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
          const accountProfile = await fetchAccountProfileWithRetry(authUser.id);

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
    [fetchAccountProfileWithRetry, reset, setLoading, setProfile, setUser, supabase]
  );

  useEffect(() => {
    fetchUser();

    // Subscribe to auth state changes (session refresh, sign-out in other tabs, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (session?.user) {
        void fetchUser({ force: true });
      } else {
        // If user was previously authenticated and session was lost, reset store.
        // Don't redirect here — let signOut() or middleware handle navigation
        // to avoid race conditions with the explicit signOut callback.
        reset();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
    // `user` is intentionally excluded — including it would cause re-subscription
    // on every state change. The SIGNED_OUT redirect reads `user` from closure.
  }, [fetchUser, supabase, reset]);

  const signOut = useCallback(async () => {
    try {
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
    window.location.href = "/";
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
