import { afterEach, describe, expect, it, vi } from "vitest";
import { isPostingLimitBypassEnabled } from "./posting-limit-bypass";

describe("isPostingLimitBypassEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always returns false in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_TEST_POSTING_BYPASS", "true");

    expect(isPostingLimitBypassEnabled()).toBe(false);
  });

  it("returns true for accepted truthy values outside production", () => {
    vi.stubEnv("NODE_ENV", "test");

    for (const value of ["1", "true", "yes", "on", " TRUE "]) {
      vi.stubEnv("ENABLE_TEST_POSTING_BYPASS", value);
      expect(isPostingLimitBypassEnabled()).toBe(true);
    }
  });

  it("returns false for missing or unsupported values outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_TEST_POSTING_BYPASS", "false");
    expect(isPostingLimitBypassEnabled()).toBe(false);

    vi.stubEnv("ENABLE_TEST_POSTING_BYPASS", "0");
    expect(isPostingLimitBypassEnabled()).toBe(false);

    vi.stubEnv("ENABLE_TEST_POSTING_BYPASS", "");
    expect(isPostingLimitBypassEnabled()).toBe(false);
  });
});
