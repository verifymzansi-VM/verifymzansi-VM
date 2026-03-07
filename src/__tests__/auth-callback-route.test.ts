import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockExchangeCodeForSession } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockExchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

import { GET } from "@/app/(auth)/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      auth: { exchangeCodeForSession: mockExchangeCodeForSession },
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
});
