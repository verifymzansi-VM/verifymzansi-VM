import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateBrowserClient, mockStubMode } = vi.hoisted(() => ({
  mockCreateBrowserClient: vi.fn(() => ({ auth: {} })),
  mockStubMode: vi.fn(() => false),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mockCreateBrowserClient,
}));

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightSupabaseStubMode: mockStubMode,
}));

describe("browser Supabase client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockStubMode.mockReturnValue(false);
    document.cookie = "vmz_pw_session=; path=/; max-age=0";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
  });

  it("supports the dashboard introductory offer RPC for authenticated fixture users", async () => {
    mockStubMode.mockReturnValue(true);
    document.cookie = "vmz_pw_session=persona:dashboard-mobile; path=/";
    const { createClient } = await import("./client");
    const { getActiveFreePostUsage } = await import("@/lib/billing/free-posts");

    const usage = await getActiveFreePostUsage(
      createClient(),
      "pw-dashboard-mobile",
      "MZANSI_MARKET"
    );

    expect(usage.available).toBe(true);
    expect(usage.offer).toEqual({
      eligible: true,
      sevenDayAvailable: true,
      thirtyDayAvailable: false,
      remaining: 0,
      launchEnabled: false,
    });
  });

  it("does not offer anonymous users a trial or silently accept unsupported RPCs", async () => {
    mockStubMode.mockReturnValue(true);
    const { createClient } = await import("./client");
    const client = createClient();

    const offer = await client.rpc("intro_trial_offer", { p_area: "MZANSI_MARKET" });
    expect(offer.data.eligible).toBe(false);
    expect(offer.data.sevenDayAvailable).toBe(false);
    const unsupported = await client.rpc("unknown_rpc");
    expect(unsupported.data).toBeNull();
    expect(unsupported.error?.message).toContain("Unsupported Playwright RPC");
  });

  it("uses @supabase/ssr cookie-session defaults for real browser clients", async () => {
    const { createClient } = await import("./client");

    createClient();

    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "public-anon-key"
    );
  });

  it("keeps the placeholder client from persisting sessions", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { createClient } = await import("./client");

    createClient();

    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://placeholder.supabase.co",
      "placeholder",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  });
});
