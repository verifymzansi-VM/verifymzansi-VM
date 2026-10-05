import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionHintProvider, useSignedInShell } from "./session-hint-provider";

function renderShell(hasSession: boolean, auth: { isAuthenticated: boolean; isLoading: boolean }) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionHintProvider hasSession={hasSession}>{children}</SessionHintProvider>
  );
  return renderHook(() => useSignedInShell(auth), { wrapper }).result.current;
}

describe("useSignedInShell", () => {
  it("shows the signed-in shell while a hinted session is still loading", () => {
    expect(renderShell(true, { isAuthenticated: false, isLoading: true })).toBe(true);
  });

  it("falls back to signed out once a hinted session fails validation", () => {
    expect(renderShell(true, { isAuthenticated: false, isLoading: false })).toBe(false);
  });

  it("stays signed out while loading when no session cookie was sent", () => {
    expect(renderShell(false, { isAuthenticated: false, isLoading: true })).toBe(false);
  });

  it("follows the validated session without a hint", () => {
    expect(renderShell(false, { isAuthenticated: true, isLoading: false })).toBe(true);
  });

  it("defaults to no hint outside the provider", () => {
    const { result } = renderHook(() =>
      useSignedInShell({ isAuthenticated: false, isLoading: true })
    );
    expect(result.current).toBe(false);
  });
});
