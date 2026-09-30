import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockExchangeCodeForSession,
  mockVerifyOtp,
  mockFrom,
  mockAdminFrom,
  mockSignOut,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockVerifyOtp: vi.fn(),
  mockFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
  mockSignOut: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET } from "@/app/(auth)/auth/callback/route";
import { verifyRecoveryProof } from "@/lib/auth/password-recovery";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      from: mockFrom,
      auth: {
        exchangeCodeForSession: mockExchangeCodeForSession,
        verifyOtp: mockVerifyOtp,
        signOut: mockSignOut,
      },
    });
    mockCreateAdminClient.mockReturnValue({
      from: mockAdminFrom,
    });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { pending_email: null }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      if (table === "contact_change_history") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }

      return {};
    });
  });

  it("redirects confirmed signups to login with a success flag", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?code=test-code&type=signup")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://verifymzansi.com/login?confirmed=true");
  });

  it("redirects non-signup callbacks to the sanitized next path", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      new Request(
        "https://verifymzansi.com/auth/callback?code=test-code&next=%2Fdashboard%3Ftab%3Dprofile"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://verifymzansi.com/dashboard?tab=profile");
  });

  it("allows password recovery callbacks to reach the reset password page", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: null });

    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?code=test-code&next=%2Freset-password")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://verifymzansi.com/reset-password");
  });

  it("verifies token-hash recovery links and redirects to the reset password page", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "isolated-test-signing-key");
    mockVerifyOtp.mockResolvedValue({
      error: null,
      data: {
        session: {
          access_token: `header.${Buffer.from(JSON.stringify({ sub: "user-1", session_id: "session-1" })).toString("base64url")}.signature`,
          user: {
            id: "user-1",
            email: "user@example.com",
            app_metadata: { provider: "email" },
          },
        },
      },
    });

    const response = await GET(
      new Request(
        "https://verifymzansi.com/auth/callback?token_hash=hash&type=recovery&next=%2Freset-password"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://verifymzansi.com/reset-password");
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "recovery" });
    const proof = response.cookies.get("vm_password_recovery")?.value;
    expect(verifyRecoveryProof(proof, "user-1", "session-1")).toBe(true);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    vi.unstubAllEnvs();
  });

  it("sends failed recovery token-hash links back to forgot password", async () => {
    mockVerifyOtp.mockResolvedValue({ error: { message: "expired token" } });

    const response = await GET(
      new Request(
        "https://verifymzansi.com/auth/callback?token_hash=expired&type=recovery&next=%2Freset-password"
      )
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://verifymzansi.com/forgot-password?error=code_expired"
    );
  });

  it("redirects failed exchanges back to login with an error flag", async () => {
    mockExchangeCodeForSession.mockResolvedValue({ error: { message: "expired" } });

    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?code=expired-code&type=signup")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://verifymzansi.com/login?error=code_expired"
    );
  });

  it("redirects to login with missing_code reason when callback has no code", async () => {
    const response = await GET(new Request("https://verifymzansi.com/auth/callback?type=signup"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://verifymzansi.com/login?error=auth_callback_failed&reason=missing_code"
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("does not attach missing_code reason when provider returned an explicit callback error", async () => {
    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?error=access_denied&type=oauth")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://verifymzansi.com/login?error=auth_callback_failed"
    );
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("creates an account profile for new OAuth users with account-first verification fields", async () => {
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });

    mockExchangeCodeForSession.mockResolvedValue({
      error: null,
      data: {
        session: {
          user: {
            id: "oauth-user-1",
            email: "oauth@example.com",
            app_metadata: { provider: "google" },
            user_metadata: { full_name: "OAuth User" },
          },
        },
      },
    });

    const mockUserScopedUpsert = vi.fn();

    // The user-scoped client is only used to detect whether the profile already existed.
    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
          upsert: mockUserScopedUpsert,
        };
      }

      return {};
    });

    // Profile creation goes through the admin client.
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockImplementation((columns: string) => ({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: columns === "account_status" ? { account_status: "active" } : null,
                error: null,
              }),
            }),
          })),
          upsert: mockUpsert.mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: "new-profile-id" },
                error: null,
              }),
            }),
          }),
        };
      }

      return {};
    });

    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?code=test-code&next=%2Fdashboard")
    );

    expect(response.status).toBe(307);
    // New OAuth users are redirected to complete-profile to add their phone number.
    expect(response.headers.get("location")).toBe(
      "https://verifymzansi.com/dashboard/complete-profile"
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "oauth-user-1",
        display_name: "OAuth User",
        account_verification_status: "incomplete",
        account_status: "active",
      }),
      { onConflict: "user_id" }
    );
    expect(mockUserScopedUpsert).not.toHaveBeenCalled();
  });

  it.each([
    ["database error", { data: null, error: { code: "08006" } }],
    ["missing profile", { data: null, error: null }],
  ])("clears returning OAuth sessions when status lookup has %s", async (_label, statusResult) => {
    if (_label === "database error") {
      mockSignOut.mockRejectedValueOnce(new Error("session cleanup unavailable"));
    }
    mockExchangeCodeForSession.mockResolvedValue({
      error: null,
      data: { session: { user: { id: "oauth-user", app_metadata: { provider: "google" } } } },
    });
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { user_id: "oauth-user" }, error: null }) }),
      }),
    });
    mockAdminFrom.mockReturnValue({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async () =>
            columns === "account_status"
              ? statusResult
              : { data: { id: "profile-id", display_name: "OAuth User" }, error: null },
        }),
      }),
    });
    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?code=test-code&next=%2Fdashboard")
    );
    expect(response.headers.get("location")).toBe(
      "https://verifymzansi.com/login?error=auth_unavailable"
    );
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("blocks banned OAuth accounts even when initial lookup misclassifies them as new", async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      error: null,
      data: { session: { user: { id: "oauth-user", app_metadata: { provider: "google" } } } },
    });
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "08006" } }) }),
      }),
    });
    mockAdminFrom.mockReturnValue({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              columns === "account_status"
                ? { account_status: "banned" }
                : { id: "profile-id", display_name: "OAuth User" },
            error: null,
          }),
        }),
      }),
    });
    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?code=test-code&next=%2Fdashboard")
    );
    expect(response.headers.get("location")).toBe(
      "https://verifymzansi.com/login?error=account_suspended"
    );
    expect(mockSignOut).toHaveBeenCalled();
  });

  it("clears pending email and marks the latest email change as applied when the confirmed email matches", async () => {
    const clearPendingEmail = vi.fn().mockResolvedValue({ error: null });
    const markApplied = vi.fn().mockResolvedValue({ error: null });

    mockExchangeCodeForSession.mockResolvedValue({
      error: null,
      data: {
        session: {
          user: {
            id: "user-1",
            email: "new@example.com",
            app_metadata: { provider: "email" },
          },
        },
      },
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { pending_email: "new@example.com" },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: clearPendingEmail,
          }),
        };
      }

      if (table === "contact_change_history") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  order: vi.fn().mockReturnValue({
                    limit: vi.fn().mockReturnValue({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: "history-1" },
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: markApplied,
          }),
        };
      }

      return {};
    });

    const response = await GET(
      new Request("https://verifymzansi.com/auth/callback?code=test-code&next=%2Fdashboard")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://verifymzansi.com/dashboard");
    expect(clearPendingEmail).toHaveBeenCalledWith("user_id", "user-1");
    expect(markApplied).toHaveBeenCalledWith("id", "history-1");
  });
});
