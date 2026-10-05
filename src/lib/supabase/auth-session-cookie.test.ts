import { describe, expect, it } from "vitest";
import { hasAuthSessionCookie, PLAYWRIGHT_SESSION_COOKIE_NAME } from "./auth-session-cookie";

describe("hasAuthSessionCookie", () => {
  it("detects plain and chunked Supabase session cookies", () => {
    expect(hasAuthSessionCookie(["sb-ref-auth-token"], false)).toBe(true);
    expect(hasAuthSessionCookie(["vm_csrf", "sb-ref-auth-token.1"], false)).toBe(true);
  });

  it("ignores unrelated and PKCE verifier cookies", () => {
    expect(hasAuthSessionCookie([], false)).toBe(false);
    expect(hasAuthSessionCookie(["vm_csrf", "sb-ref-auth-token-code-verifier"], false)).toBe(false);
  });

  it("uses only the Playwright session cookie in stub mode", () => {
    expect(hasAuthSessionCookie([PLAYWRIGHT_SESSION_COOKIE_NAME], true)).toBe(true);
    expect(hasAuthSessionCookie(["sb-ref-auth-token"], true)).toBe(false);
  });
});
