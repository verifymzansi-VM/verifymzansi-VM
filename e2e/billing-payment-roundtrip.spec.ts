import { expect, test, type Page } from "@playwright/test";

async function openAuthenticatedBilling(page: Page) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const sessionResponse = await page.goto(
      "/api/e2e/auth/session?persona=billing-payment&reset=1",
      {
        waitUntil: "networkidle",
      }
    );
    expect(sessionResponse?.ok()).toBeTruthy();

    await page.goto("/billing", { waitUntil: "networkidle" });

    const redirectedToAuth = /\/(login|sign-in)(\?|$)/i.test(new URL(page.url()).pathname);
    if (!redirectedToAuth) {
      return;
    }

    if (attempt === maxAttempts) {
      await expect(page).not.toHaveURL(/\/(login|sign-in)(\?|$)/i);
      return;
    }
  }
}

test.describe("Billing payment round-trip", () => {
  test("completes a mock Ozow checkout and reaches confirmed success state", async ({ page }) => {
    await openAuthenticatedBilling(page);

    const checkoutResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/billing/create-checkout") &&
        response.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: /choose mzansi market growth/i }).click();
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
