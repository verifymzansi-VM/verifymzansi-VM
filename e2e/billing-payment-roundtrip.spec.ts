import { expect, test } from "@playwright/test";

test.describe("Billing payment round-trip", () => {
  test("completes a mock Ozow checkout and reaches confirmed success state", async ({ page }) => {
    await page.goto("/api/e2e/auth/session?persona=billing-payment&reset=1", {
      waitUntil: "networkidle",
    });

    await page.goto("/billing", { waitUntil: "networkidle" });

    const checkoutResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/billing/create-checkout") &&
        response.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: "Choose Growth" }).first().click();
    const checkoutResponse = await checkoutResponsePromise;
    expect(checkoutResponse.ok()).toBeTruthy();
    await page.waitForURL("**/billing/success?payment=*", { timeout: 30000 });

    await expect(page).toHaveURL(/\/billing\/success\?payment=/);
    await expect(page.getByRole("heading", { name: "Payment Confirmed" })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByText("Your payment has been confirmed and your paid features are now active.")
    ).toBeVisible();
  });
});
