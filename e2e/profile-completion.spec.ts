import { expect, test } from "@playwright/test";
import { POSTING_CHROMIUM_STATE } from "./auth-state";

test.use({ storageState: POSTING_CHROMIUM_STATE });

test.describe("Complete profile flow", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium");
  });

  test("@smoke saves a phone number and returns to the requested destination", async ({ page }) => {
    await page.goto("/dashboard/complete-profile?returnUrl=%2Fdashboard");

    await expect(
      page.getByRole("heading", { level: 1, name: "Add Your Phone Number" })
    ).toBeVisible();

    await page.getByLabel(/SA mobile number/i).fill("0712345678");

    const updateResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/profile/update") &&
        response.request().method() === "POST" &&
        response.ok()
    );

    await page.getByRole("button", { name: /Save & Continue/i }).click();
    await updateResponse;

    await expect(page.getByText("Phone number saved!")).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
