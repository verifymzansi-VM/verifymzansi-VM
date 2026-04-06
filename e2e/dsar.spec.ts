import { expect, test } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit rendering under headless CI is unreliable for page-navigation tests.";

test.describe("DSAR (Data Subject Access Request)", () => {
  test("@smoke DSAR page requires sign-in", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/dsar", { waitUntil: "domcontentloaded" });

    await page.waitForURL("**/login**", { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("@smoke DSAR form is unavailable while signed out", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/dsar");

    await expect(page).toHaveURL(/\/login/);
  });
});
