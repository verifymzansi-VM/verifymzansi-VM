"use client";

import { createContext, useContext, type ReactNode } from "react";

const SessionHintContext = createContext(false);

/**
 * Carries the server's "a session cookie was sent" hint to client components,
 * so the first paint matches the signed-in shell instead of swapping to it
 * once the browser finishes its session lookup.
 */
export function SessionHintProvider({
  hasSession,
  children,
}: {
  hasSession: boolean;
  children: ReactNode;
}) {
  return <SessionHintContext.Provider value={hasSession}>{children}</SessionHintContext.Provider>;
}

/**
 * Whether site chrome should show its signed-in state. While the session
 * lookup is still running, trust the server hint; once it settles, the
 * validated auth state wins (a stale cookie falls back to signed out).
 */
export function useSignedInShell(auth: { isAuthenticated: boolean; isLoading: boolean }): boolean {
  const hasSession = useContext(SessionHintContext);
  return auth.isAuthenticated || (auth.isLoading && hasSession);
}
