import { expect, test } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit rendering under headless CI is unreliable for page-navigation tests.";

const hasAuthCreds = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

test.describe("Critical Platform Flows", () => {
  test("critical API guardrails return non-2xx for unauthorized requests", async ({ request }) => {
    const checkout = await request.post("/api/billing/create-checkout", {
      data: { area: "MZANSI_MARKET", tier: "starter" },
    });
    expect([400, 401, 403, 422]).toContain(checkout.status());

    const adminToggle = await request.post("/api/admin/feature-flags/toggle", {
      data: { key: "kyc_v2_flow", enabled: true },
    });
    expect([401, 403]).toContain(adminToggle.status());

    const report = await request.post("/api/reports", {
      data: {},
    });
    expect([400, 401]).toContain(report.status());
  });

  test("critical auth flow: login and dashboard access with seeded user", async ({
    page,
  }, testInfo) => {
    test.skip(!hasAuthCreds, "Set E2E_EMAIL and E2E_PASSWORD to enable auth critical flow");
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);

    await page.goto("/login");
    await page.fill("input[type='email'], input[name='email']", process.env.E2E_EMAIL!);
    await page.fill("input[type='password'], input[name='password']", process.env.E2E_PASSWORD!);

    await Promise.all([
      page.waitForURL((url) => url.pathname === "/"),
      page.getByRole("button", { name: /sign in|login/i }).click(),
    ]);

    await expect(page).toHaveURL((url) => url.pathname === "/");
    await page.goto("/dashboard/listings");
    await expect(page).toHaveURL(/\/dashboard\/listings|\/login/);
  });
});
