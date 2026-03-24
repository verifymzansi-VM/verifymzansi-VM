import { afterEach, describe, expect, it } from "vitest";
import { shouldHidePlaywrightFixtureRow } from "./playwright-fixture-filter";

describe("shouldHidePlaywrightFixtureRow", () => {
  afterEach(() => {
    delete process.env.PLAYWRIGHT_TEST_MODE;
    delete process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE;
  });

  it("ignores Playwright-owned marketplace rows during Playwright runs", () => {
    process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE = "1";

    expect(
      shouldHidePlaywrightFixtureRow({
        id: "listing-1",
        owner_id: "pw-posting-chromium",
        title: "Playwright iPhone 15 Pro",
      })
    ).toBe(true);
  });

  it("keeps non-Playwright rows visible during Playwright runs", () => {
    process.env.NEXT_PUBLIC_PLAYWRIGHT_TEST_MODE = "1";

    expect(
      shouldHidePlaywrightFixtureRow({
        id: "listing-2",
        owner_id: "7b1a9d88-8f41-4d2d-8a6f-f0f0ed3d1a3e",
        title: "Canon EOS R6",
      })
    ).toBe(false);
  });

  it("does not hide rows outside Playwright mode", () => {
    expect(
      shouldHidePlaywrightFixtureRow({
        id: "listing-3",
        owner_id: "pw-posting-chromium",
        title: "Playwright iPhone 15 Pro",
      })
    ).toBe(false);
  });
});
