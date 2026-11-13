import { describe, expect, it } from "vitest";
import { hasAuthSessionCookie } from "./auth-session-cookie";

describe("hasAuthSessionCookie", () => {
  it("detects plain and chunked Supabase session cookies", () => {
    expect(hasAuthSessionCookie(["sb-ref-auth-token"])).toBe(true);
    expect(hasAuthSessionCookie(["vm_csrf", "sb-ref-auth-token.1"])).toBe(true);
  });

  it("ignores unrelated, retired stub and PKCE verifier cookies", () => {
    expect(hasAuthSessionCookie([])).toBe(false);
    expect(hasAuthSessionCookie(["vm_csrf", "sb-ref-auth-token-code-verifier"])).toBe(false);
    expect(hasAuthSessionCookie(["vmz_pw_session"])).toBe(false);
  });
});
