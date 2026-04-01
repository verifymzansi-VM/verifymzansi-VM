import { test, expect } from "@playwright/test";

const WEBKIT_SKIP = ["webkit", "mobile-safari"];
const WEBKIT_SKIP_MSG =
  "WebKit rendering under headless CI is unreliable for page-navigation tests.";

test.describe("VerifyMzansi Golden Paths", () => {
  test("Homepage loads with hero and marketplace sections", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/");
    await expect(page).toHaveTitle(/VerifyMzansi/i);
    // Hero section visible
    await expect(page.getByRole("heading").first()).toBeVisible();
    // At least one marketplace area link visible (mobile-safe selector)
    await expect(page.getByRole("link", { name: /Mzansi Business/i }).first()).toBeVisible();
  });

  test("Login page renders correctly", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/login");
    await expect(page.getByRole("heading").filter({ hasText: /Login|Sign In/i })).toBeVisible();
    // Email/password fields present
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("Registration page renders correctly", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/register");
    await expect(
      page
        .getByRole("heading")
        .filter({ hasText: /Register|Create Account|Sign Up|Create your account/i })
    ).toBeVisible();
  });

  test("API health check responds 200", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toHaveProperty("status");
  });

  test("Pricing page renders plans", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/pricing");
    // Should show at least one plan tier heading in main content
    await expect(
      page
        .locator("main")
        .getByRole("heading", { name: /Starter|Growth|Pro/i })
        .first()
    ).toBeVisible();
  });

  test("Public marketplace page loads", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    const response = await page.goto("/mzansi-market");
    // Should load without server errors (allow redirects)
    expect(response?.status()).toBeLessThan(500);
  });

  test("Legacy marketplace routes redirect to mzansi-business", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    await page.goto("/business-ads", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/mzansi-business/, { timeout: 15_000 });

    await page.goto("/mall-shops", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/mzansi-business\?type=mall_store/, { timeout: 15_000 });
  });

  test("KYC verification page requires auth", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    // Should redirect to login when not authenticated
    await page.goto("/verification");
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("/login");
  });

  test("Billing page requires auth", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    // Should redirect to login when not authenticated
    await page.goto("/billing");
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain("/login");
  });

  test("404 page renders for unknown routes", async ({ page }, testInfo) => {
    test.skip(WEBKIT_SKIP.includes(testInfo.project.name), WEBKIT_SKIP_MSG);
    const response = await page.goto("/this-page-does-not-exist-12345");
    expect(response?.status()).toBe(404);
  });
});
