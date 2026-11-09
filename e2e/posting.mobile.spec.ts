import { test } from "@playwright/test";
import { POSTING_MOBILE_STATE } from "./auth-state";
import {
  completeMobileBusinessCreate,
  completeMobileListingCreate,
  completeMobilePromotionCreate,
} from "./support/mobile-posting";

test.use({ storageState: POSTING_MOBILE_STATE });
test.describe.configure({ mode: "serial" });

test.describe("Posting flows on mobile Chrome", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile-chrome",
      "Mobile posting flows run once, in the mobile-chrome project."
    );
  });

  test.setTimeout(120_000);

  test("creates one market listing", async ({ page }) => {
    await completeMobileListingCreate(page);
  });

  test("creates one business", async ({ page }) => {
    await completeMobileBusinessCreate(page);
  });

  test("creates one promotion", async ({ page }) => {
    await completeMobilePromotionCreate(page);
  });
});
