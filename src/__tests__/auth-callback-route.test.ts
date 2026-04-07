import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateClient,
  mockCreateAdminClient,
  mockExchangeCodeForSession,
  mockFrom,
  mockAdminFrom,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
  mockFrom: vi.fn(),
  mockAdminFrom: vi.fn(),
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

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      from: mockFrom,
      auth: { exchangeCodeForSession: mockExchangeCodeForSession },
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

    mockFrom.mockImplementation((table: string) => {
      if (table === "account_profiles") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
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
