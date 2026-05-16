import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateBrowserClient } = vi.hoisted(() => ({
  mockCreateBrowserClient: vi.fn(() => ({ auth: {} })),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mockCreateBrowserClient,
}));

vi.mock("@/lib/supabase/playwright-mode", () => ({
  isPlaywrightSupabaseStubMode: () => false,
}));

describe("browser Supabase client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
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
