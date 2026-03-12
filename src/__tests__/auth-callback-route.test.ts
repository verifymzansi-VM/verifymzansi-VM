import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockCreateAdminClient, mockExchangeCodeForSession, mockFrom } =
  vi.hoisted(() => ({
    mockCreateClient: vi.fn(),
    mockCreateAdminClient: vi.fn(),
    mockExchangeCodeForSession: vi.fn(),
    mockFrom: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { GET } from "@/app/(auth)/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchangeCodeForSession },
    });
    mockCreateAdminClient.mockReturnValue({
      from: mockFrom,
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
      "https://verifymzansi.com/login?error=auth_callback_failed"
    );
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
          upsert: mockUpsert,
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
});
