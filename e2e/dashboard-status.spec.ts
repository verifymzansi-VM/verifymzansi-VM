import { expect, test, type Page } from "@playwright/test";

/** CSP style-src violations are infrastructure noise — not app bugs. */
const CSP_STYLE_RE = /Content Security Policy directive 'style-src/;

function collectDashboardErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" && !CSP_STYLE_RE.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  return { consoleErrors, pageErrors };
}

test.describe("Dashboard verification state", () => {
  async function signInFixtureUser(page: Page, persona: string) {
    const response = await page.goto(`/api/e2e/auth/session?persona=${persona}&reset=1`);
    expect(response?.ok()).toBe(true);
  }

  test.describe("desktop", () => {
    test("verified dashboard shows no verification warning banners", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium");

      const errors = collectDashboardErrors(page);

      await signInFixtureUser(page, "dashboard-chromium");
      await page.goto("/dashboard");

      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: /^hi,/i })).toBeVisible();
      await expect(page.getByText(/^verified$/i)).toBeVisible();
      await expect(page.getByText(/steps left/i)).toHaveCount(0);
      await expect(page.getByText(/verification under review/i)).toHaveCount(0);

      expect(errors.consoleErrors).toEqual([]);
      expect(errors.pageErrors).toEqual([]);
    });
  });

  test.describe("mobile", () => {
    test("mobile dashboard renders without verification regressions", async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile-chrome");

      const errors = collectDashboardErrors(page);

      await signInFixtureUser(page, "dashboard-mobile");
      await page.goto("/dashboard");

      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByRole("heading", { name: /^hi,/i })).toBeVisible();
      await expect(page.getByText(/steps left/i)).toHaveCount(0);
      await expect(page.getByText(/verification under review/i)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Post", exact: true })).toBeVisible();
      // Auth state in MobileNav hydrates asynchronously — give it time
      await expect(page.getByRole("link", { name: "Post", exact: true })).toHaveAttribute(
        "href",
        "/post/create",
        { timeout: 15_000 }
      );
      await expect(page.getByRole("link", { name: "Leads", exact: true })).toHaveAttribute(
        "href",
        "/dashboard/leads",
        { timeout: 15_000 }
      );

      await page.goto("/dashboard/profile", { waitUntil: "networkidle" });
      const profileTab = page.getByRole("tab", { name: /profile/i }).first();
      await expect(profileTab).toBeVisible();
      const profileTabBox = await profileTab.boundingBox();
      expect(profileTabBox).not.toBeNull();
      expect(profileTabBox!.height).toBeGreaterThanOrEqual(40);

      await page.goto("/dashboard", { waitUntil: "networkidle" });

      const quickLink = page.getByRole("link", { name: /my posts/i }).first();
      await expect(quickLink).toBeVisible();
      const quickLinkBox = await quickLink.boundingBox();
      expect(quickLinkBox).not.toBeNull();
      expect(quickLinkBox!.height).toBeGreaterThanOrEqual(44);

      await expect(page.getByText("Install App")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Install" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "How To Install" })).toHaveCount(0);
      await expect(page.getByLabel("Dismiss install prompt")).toHaveCount(0);

      expect(errors.consoleErrors).toEqual([]);
      expect(errors.pageErrors).toEqual([]);
    });
  });
});
