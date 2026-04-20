import { expect, test } from "@playwright/test";

test.describe("DSAR (Data Subject Access Request)", () => {
  test("@smoke DSAR page requires sign-in", async ({ page }) => {
    await page.goto("/dsar", { waitUntil: "domcontentloaded" });

    await page.waitForURL("**/login**", { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("@smoke DSAR form is unavailable while signed out", async ({ page }) => {
    await page.goto("/dsar");

    await expect(page).toHaveURL(/\/login/);
  });
});
