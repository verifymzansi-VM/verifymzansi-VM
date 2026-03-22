import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreatePlaywrightSession, mockResetPlaywrightFixtureStoreForPersona } = vi.hoisted(
  () => ({
    mockCreatePlaywrightSession: vi.fn(),
    mockResetPlaywrightFixtureStoreForPersona: vi.fn(),
  })
);

vi.mock("@/lib/supabase/playwright-fixture-store", () => ({
  createPlaywrightSession: mockCreatePlaywrightSession,
  resetPlaywrightFixtureStoreForPersona: mockResetPlaywrightFixtureStoreForPersona,
}));

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightSupabaseStubMode: () => true,
  isPlaywrightTestMode: () => true,
}));

import { GET } from "@/app/api/e2e/auth/session/route";

describe("GET /api/e2e/auth/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePlaywrightSession.mockReturnValue({
      token: "token-1",
      user: {
        id: "user-1",
        email: "verified-member@playwright.verifymzansi.test",
      },
    });
  });

  it("rejects invalid persona characters", async () => {
    const res = await GET(
      new Request("http://localhost/api/e2e/auth/session?persona=bad!persona") as never
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid Playwright session query" });
  });

  it("normalizes reset flags and resets fixture state", async () => {
    const res = await GET(
      new Request("http://localhost/api/e2e/auth/session?project=verified-member&reset=1") as never
    );

    expect(res.status).toBe(200);
    expect(mockResetPlaywrightFixtureStoreForPersona).toHaveBeenCalledWith("verified-member");
    expect(mockCreatePlaywrightSession).toHaveBeenCalledWith("verified-member");
    expect(res.headers.get("set-cookie")).toContain("vmz_pw_session=token-1");
  });
});
