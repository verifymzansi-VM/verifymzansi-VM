import { afterEach, describe, expect, it, vi } from "vitest";

describe("playwright-mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("keeps Playwright test mode off in production without explicit e2e runtime", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");

    const { isPlaywrightTestMode } = await import("./playwright-mode");

    expect(isPlaywrightTestMode()).toBe(false);
  });

  it("allows Playwright test mode in production when explicit e2e runtime is set", async () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE", "1");

    const { isPlaywrightTestMode } = await import("./playwright-mode");

    expect(isPlaywrightTestMode()).toBe(true);
  });

  it("keeps browser Playwright mode off without server marker", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
      },
    });
    vi.stubEnv("NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE", "1");

    const { isPlaywrightTestMode } = await import("./playwright-mode");

    expect(isPlaywrightTestMode()).toBe(false);
  });

  it("enables browser Playwright mode only with server marker", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      documentElement: {
        dataset: { playwright: "1" },
      },
    });
    vi.stubEnv("NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE", "1");

    const { isPlaywrightTestMode } = await import("./playwright-mode");

    expect(isPlaywrightTestMode()).toBe(true);
  });
});
