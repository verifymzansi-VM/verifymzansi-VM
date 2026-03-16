import { afterEach, describe, expect, it, vi } from "vitest";

describe("playwright-mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps Playwright test mode off in production without explicit e2e runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");

    const { isPlaywrightTestMode, isPlaywrightSupabaseStubMode } =
      await import("./playwright-mode");

    expect(isPlaywrightTestMode()).toBe(false);
    expect(isPlaywrightSupabaseStubMode()).toBe(false);
  });

  it("allows Playwright modes in production when explicit e2e runtime is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    vi.stubEnv("PLAYWRIGHT_SUPABASE_MODE", "stub");
    vi.stubEnv("NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_PLAYWRIGHT_SUPABASE_MODE", "stub");

    const { isPlaywrightTestMode, isPlaywrightSupabaseStubMode } =
      await import("./playwright-mode");

    expect(isPlaywrightTestMode()).toBe(true);
    expect(isPlaywrightSupabaseStubMode()).toBe(true);
  });
});
