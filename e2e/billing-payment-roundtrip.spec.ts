import { expect, test, type Page } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit rendering under headless CI is unreliable for page-navigation tests.";

async function openAuthenticatedBilling(page: Page, persona: string) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const sessionResponse = await page.goto(
      `/api/e2e/auth/session?persona=${encodeURIComponent(persona)}&reset=1`,
      {
        waitUntil: "networkidle",
      }
    );
    expect(sessionResponse?.ok()).toBeTruthy();

    await page.goto("/billing", { waitUntil: "networkidle" });

    const redirectedToAuth = /\/(login|sign-in)(\?|$)/i.test(new URL(page.url()).pathname);
    if (!redirectedToAuth) {
      const csrfResponse = await page.request.get("/api/csrf");
      expect(csrfResponse.ok()).toBeTruthy();
      return;
    }

    if (attempt === maxAttempts) {
      await expect(page).not.toHaveURL(/\/(login|sign-in)(\?|$)/i);
      return;
    }
  }
}

test.describe("Billing payment round-trip", () => {
  test("offers sign-in recovery when the session expires while confirming a payment", async ({
    page,
  }, testInfo) => {
    await openAuthenticatedBilling(page, `billing-expired-${testInfo.project.name}`);
    // Simulate returning before the provider callback, then losing the session
    // during status polling. The checkout still uses the local fixture backend.
    await page.route("**/api/mock-ozow?*", async (route) => {
      const returnUrl = new URL(route.request().url()).searchParams.get("returnUrl");
      expect(returnUrl).toBeTruthy();
      await route.fulfill({ status: 302, headers: { location: returnUrl! } });
    });
    await page.route("**/api/billing/payment-status?*", (route) =>
      route.fulfill({ status: 401, json: { error: "Unauthorized" } })
    );
    await page.getByRole("link", { name: /choose 6 months — mzansi market/i }).click();
    await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
    await page.getByRole("button", { name: /pay r250 securely/i }).click();
    await page.waitForURL("**/billing/success?payment=*");
    await expect(
      page.getByRole("heading", { name: "Sign in to check your payment" })
    ).toBeVisible();
    const returnPath = new URL(page.url()).pathname + new URL(page.url()).search;
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute(
      "href",
      `/login?returnUrl=${encodeURIComponent(returnPath)}`
    );
    await expect(page.getByText(/Refreshing payment status while/)).toHaveCount(0);
  });

  test("completes a mock Ozow checkout and reaches confirmed success state", async ({
    page,
  }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await openAuthenticatedBilling(page, `billing-payment-${testInfo.project.name}`);

    // Choosing a plan opens the confirmation page (dates, slots, no auto-renewal).
    await page.getByRole("link", { name: /choose 6 months — mzansi market/i }).click();
    await page.waitForURL("**/billing/checkout?plan=*");
    await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
    await expect(page.getByText("Does not renew automatically")).toBeVisible();
    await expect(page.getByText("6 months", { exact: true })).toBeVisible();

    const checkoutResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/billing/create-checkout") &&
        response.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.getByRole("button", { name: /pay r250 securely/i }).click();
    const checkoutResponse = await checkoutResponsePromise;
    expect(checkoutResponse.ok()).toBeTruthy();
    await page.waitForURL("**/billing/success?payment=*", { timeout: 30000 });

    await expect(page).toHaveURL(/\/billing\/success\?payment=/);
    await expect(page.getByRole("heading", { name: "Payment confirmed" })).toBeVisible({
      timeout: 30000,
    });
    await expect(
      page.getByText("Your payment has been confirmed and your paid features are now active.")
    ).toBeVisible();
  });
});
