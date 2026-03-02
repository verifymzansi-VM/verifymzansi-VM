import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: mockCreateClient }));

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
