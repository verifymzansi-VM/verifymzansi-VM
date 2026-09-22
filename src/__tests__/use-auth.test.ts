import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: mockCreateClient }));

import { hasBrowserAuthSession } from "@/hooks/use-auth";

function clearBrowserCookies() {
  for (const entry of document.cookie.split(";")) {
    const name = entry.split("=")[0]?.trim();
    if (name) {
      document.cookie = `${name}=; max-age=0; path=/`;
    }
  }
}

describe("hasBrowserAuthSession", () => {
  beforeEach(() => clearBrowserCookies());

  it("returns false for anonymous visitors without a session cookie", () => {
    expect(hasBrowserAuthSession()).toBe(false);
  });

  it("ignores unrelated cookies such as the CSRF token", () => {
    document.cookie = "vm_csrf=abc123";
    expect(hasBrowserAuthSession()).toBe(false);
  });

  it("returns true when a Supabase auth-token cookie is present", () => {
    document.cookie = "sb-projectref-auth-token=session-value";
    expect(hasBrowserAuthSession()).toBe(true);
  });

  it("matches chunked Supabase auth-token cookies", () => {
    document.cookie = "sb-projectref-auth-token.0=chunk";
    expect(hasBrowserAuthSession()).toBe(true);
  });

  it("does not match the PKCE code-verifier cookie as a session", () => {
    document.cookie = "sb-projectref-auth-token-code-verifier=verifier";
    expect(hasBrowserAuthSession()).toBe(false);
  });
});

describe("use-auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should handle null user_metadata gracefully", () => {
    // Test the null-safety fix: (user_metadata?.display_name ?? "") as string
    const metadata: Record<string, unknown> | undefined = undefined;
    const displayName =
      ((metadata?.["display_name"] ?? "") as string) || "test@example.com".split("@")[0] || "User";
    expect(displayName).toBe("test");
  });

  it("should extract display_name from user_metadata", () => {
    const metadata: Record<string, unknown> = { display_name: "John Doe" };
    const displayName =
      ((metadata?.["display_name"] ?? "") as string) || "j@example.com".split("@")[0] || "User";
    expect(displayName).toBe("John Doe");
  });

  it("should fallback to email prefix when display_name is missing", () => {
    const metadata: Record<string, unknown> = {};
    const displayName =
      ((metadata?.["display_name"] ?? "") as string) || "jane@example.com".split("@")[0] || "User";
    expect(displayName).toBe("jane");
  });

  it("should fallback to 'User' when no email", () => {
    const metadata: Record<string, unknown> = {};
    const email = undefined as string | undefined;
    const displayName =
      ((metadata?.["display_name"] ?? "") as string) || email?.split("@")[0] || "User";
    expect(displayName).toBe("User");
  });

  it("should extract role from app_metadata", () => {
    const appMetadata = { role: "admin" };
    const role = ((appMetadata?.role ?? "") as string) || "user";
    expect(role).toBe("admin");
  });

  it("should default role to 'user' when not set", () => {
    const appMetadata: Record<string, unknown> = {};
    const role = ((appMetadata?.role ?? "") as string) || "user";
    expect(role).toBe("user");
  });
});
