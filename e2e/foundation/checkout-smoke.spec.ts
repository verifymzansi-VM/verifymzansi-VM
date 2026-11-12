import { expect, test } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import {
  browserSessionCookies,
  clearUnpaidMockCheckouts,
  queryTestCopy,
  readTestCopy,
  rpc,
} from "./support/test-copy";

// Checkout smoke test for the private test copy (M0.8): a signed-in member goes
// through the website's own checkout (confirmation page, create-checkout route,
// SQL quote, mock provider, checkout URL guard, SQL attach) and lands on the
// mock payment page. Paying, the signed notification and fulfilment are M0.9c.
// The member's unpaid mock checkouts are cleared first, so every run (each
// project, retry or rerun) creates a new quote and takes the provider path
// rather than reusing a stored checkout URL.
//
// Browser HTTP(S) requests are checked against an allowlist: the copy's
// website and its local database gateway continue, the mock payment page is
// served here, and anything else is aborted and fails the test. Requests the
// website's server makes are not visible here; the provider being the mock is
// asserted from the stored provider request id.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const MOCK_PAYMENT_ORIGIN = `https://127.0.0.1:${E2E_FIXTURE.mockPaymentPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Plan = {
  id: string;
  code: string;
  label: string;
  price_cents: string;
  activation_period_days?: number;
  activations_per_period?: number | null;
};

/** The mock payment page: static, no scripts, nothing loaded from elsewhere. */
function mockPaymentPage(url: URL) {
  const amount = url.searchParams.get("amount") ?? "";
  const shown = /^[0-9]{1,9}\.[0-9]{2}$/.test(amount) ? `R ${amount}` : "unknown amount";
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Mock Ozow</title></head>',
    `<body><h1>Mock Ozow test payment</h1><p>Amount: ${shown}</p></body></html>`,
  ].join("");
}

// A service worker could fetch outside page routing; the allowlist must see every request.
test.use({ serviceWorkers: "block" });

// Read in beforeAll, never at import time: listing specs must not touch the copy.
let state: ReturnType<typeof readTestCopy>;
let plan: Plan;

// The first old plan's id from the seeded catalogue (catalogue-identities.json).
const OLD_PLAN_ID = "00420f8c-0ac1-4828-83c5-d547d862fc8f";

// The old plans stay as history once the Individual slots are on sale. A
// signed-in member passes sign-in, origin and CSRF, so the refusal here is the
// plan itself: the page offers no payment and the route sells nothing.
test.describe("an old plan while the Individual slots are on sale", () => {
  test("a signed-in member can neither open nor buy an old plan", async ({ context, page }) => {
    const session = await browserSessionCookies(readTestCopy(), "verifiedMember");
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    await page.goto(`/billing/checkout?plan=${OLD_PLAN_ID}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("This plan is not available. Please choose a plan from the pricing page.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay / })).toHaveCount(0);
    const csrf = (await context.cookies(APP_ORIGIN)).find((cookie) => cookie.name === "vm_csrf");
    expect(csrf?.value).toMatch(/^[a-f0-9]{64}$/i);
    const refused = await page.request.post(`${APP_ORIGIN}/api/billing/create-checkout`, {
      headers: { origin: APP_ORIGIN, "x-csrf-token": csrf!.value },
      data: { planId: OLD_PLAN_ID, slots: 1, expectedTotalCents: 5000, coolingOffConsent: true },
      maxRedirects: 0,
    });
    expect(refused.status()).toBe(400);
    expect(await refused.json()).toEqual({
      error: "This plan is not available in the selected section",
    });
  });
});

test.describe("checkout in the foundation test copy", () => {
  test.beforeAll(async () => {
    state = readTestCopy();
    // The public catalogue command the checkout page reads.
    const catalogue = await rpc(state, "billing_catalogue", {});
    expect(catalogue.status).toBe(200);
    const plans = (catalogue.data.plans as Plan[])
      .filter(
        (entry) => entry.activation_period_days === 30 && entry.activations_per_period !== undefined
      )
      .sort(
        (a, b) => Number(a.price_cents) - Number(b.price_cents) || a.code.localeCompare(b.code)
      );
    expect(plans.length).toBeGreaterThan(0);
    plan = plans[0];
  });

  test("a member's checkout reaches the mock payment page; browser requests stay on loopback", async ({
    context,
    page,
  }) => {
    const outside: string[] = [];
    const created: { status: number; body: unknown }[] = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === MOCK_PAYMENT_ORIGIN)
        return route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: mockPaymentPage(url),
        });
      // The checkout reply is read on its way through: the page leaves at once.
      if (url.href === `${APP_ORIGIN}/api/billing/create-checkout` && request.method() === "POST") {
        const response = await route.fetch({ maxRedirects: 0 });
        const text = await response.text();
        created.push({ status: response.status(), body: JSON.parse(text) });
        return route.fulfill({ response, body: text });
      }
      if (url.origin === APP_ORIGIN || url.origin === API_ORIGIN) return route.continue();
      outside.push(url.origin);
      return route.abort("blockedbyclient");
    });

    const session = await browserSessionCookies(state, "verifiedMember");
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
    expect(clearUnpaidMockCheckouts(session.accountId)).toBe(0);

    await page.goto(`/billing/checkout?plan=${plan.id}`);
    await expect(page.getByRole("heading", { name: "Confirm your plan" })).toBeVisible();
    await expect(page.getByText(plan.label, { exact: true })).toBeVisible();

    // posting-v4: the cooling-off box, then one slot at the plan's price.
    await page.getByRole("checkbox", { name: /^My slot starts now/ }).check();
    await page.getByRole("button", { name: /^Pay .+ securely$/ }).click();
    await page.waitForURL((url) => url.origin === MOCK_PAYMENT_ORIGIN);
    await expect(page.getByRole("heading", { name: "Mock Ozow test payment" })).toBeVisible();

    const landed = new URL(page.url());
    const paymentId = landed.searchParams.get("paymentId") ?? "";
    expect(paymentId).toMatch(UUID);
    expect(landed.pathname).toBe("/checkout");
    expect(created).toEqual([
      {
        status: 200,
        body: { paymentId, checkoutUrl: landed.href, account_id: session.accountId },
      },
    ]);
    expect(landed.searchParams.get("amount")).toBe((Number(plan.price_cents) / 100).toFixed(2));
    expect(landed.searchParams.get("returnUrl")).toBe(
      `${APP_ORIGIN}/billing/success?payment=${paymentId}`
    );
    expect(landed.searchParams.get("cancelUrl")).toBe(
      `${APP_ORIGIN}/billing/cancel?payment=${paymentId}`
    );

    // The copy's database holds the member's pending payment with the mock
    // provider's request id and this exact checkout URL (never an Ozow one).
    const row = queryTestCopy(
      "select owner_id, status, amount_cents, provider_request_id, checkout_url " +
        `from private.payments where id = '${paymentId}';`
    );
    expect(row.split("|")).toEqual([
      session.accountId,
      "pending",
      plan.price_cents,
      `mock-${paymentId}`,
      landed.href,
    ]);
    // A new quote: no stored checkout URL existed, so the provider path ran.
    expect(
      queryTestCopy(
        `select count(*) from private.payments where owner_id = '${session.accountId}' and status = 'pending';`
      )
    ).toBe("1");
    expect(outside).toEqual([]);
  });
});
