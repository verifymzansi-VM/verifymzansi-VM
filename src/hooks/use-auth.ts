"use client";

import { useEffect, useCallback, useRef } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { normalizeUserRole, readAccountVerificationStatus } from "@/lib/account/compat";
import { createClient } from "@/lib/supabase/client";
import { createLogger } from "@/lib/utils/logger";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const log = createLogger("useAuth");

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

  const fetchUser = useCallback(async () => {
    // Guard: skip if we already fetched during this component lifecycle.
    // The Zustand store is shared, so other useAuth() consumers see the
    // same data without triggering duplicate Supabase round-trips.
    if (fetchedRef.current) return;
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
        displayName:
          ((authUser.user_metadata?.display_name ?? "") as string) ||
          authUser.email?.split("@")[0] ||
          "User",
        role: readSessionRole(authUser.app_metadata?.role),
      });

      // Fetch account profile
      const { data: accountProfile } = await supabase
        .from("seller_profiles")
        .select("*")
        .eq("user_id", authUser.id)
        .single();

      if (accountProfile) {
        setProfile(accountProfile);
      }
    } catch (err) {
      log.error("Failed to fetch user", {
        error: err instanceof Error ? err.message : String(err),
      });
      reset();
    } finally {
      setLoading(false);
    }
    // supabase is a stable singleton — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setUser, setProfile, setLoading, reset]);

  useEffect(() => {
    fetchUser();

    // Subscribe to auth state changes (session refresh, sign-out in other tabs, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || "",
          displayName:
            (session.user.user_metadata?.display_name as string) ||
            session.user.email?.split("@")[0] ||
            "User",
          role: readSessionRole(session.user.app_metadata?.role),
        });
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
  }, [fetchUser, supabase, setUser, reset]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      log.error("Sign-out failed", { error: err instanceof Error ? err.message : String(err) });
    }
    reset();
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
    refresh: fetchUser,
  };
}
