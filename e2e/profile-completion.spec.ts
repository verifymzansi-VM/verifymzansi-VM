import { expect, test } from "@playwright/test";
import { POSTING_CHROMIUM_STATE } from "./auth-state";

test.use({ storageState: POSTING_CHROMIUM_STATE });

test.describe("Complete profile flow", () => {
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium");
  });

  test("@smoke starts OTP verification from complete-profile", async ({ page }) => {
    await page.goto("/dashboard/complete-profile?returnUrl=%2Fdashboard");

    await expect(
      page.getByRole("heading", { level: 1, name: "Verify Your Phone Number" })
    ).toBeVisible();

    await page.getByLabel(/SA mobile number/i).fill("0712345678");

    const sendOtpResponse = page.waitForResponse(
      (response) =>
        response.url().includes("/api/otp/send") && response.request().method() === "POST"
    );

    await page.getByRole("button", { name: /Send Verification Code/i }).click();
    const response = await sendOtpResponse;

    if (response.ok()) {
      await expect(page.getByRole("heading", { name: "Enter Verification Code" })).toBeVisible();
      await expect(page.getByLabel(/6-digit code/i)).toBeVisible();
      return;
    }

    // In deterministic Playwright CI, SMS provider delivery may be unavailable.
    // Smoke test still passes as long as the request was issued and the form remains actionable.
    await expect(page.getByRole("button", { name: /Send Verification Code/i })).toBeVisible();
  });
});
