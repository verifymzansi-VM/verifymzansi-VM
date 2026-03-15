import { expect, test, type Page } from "@playwright/test";

function collectDashboardErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
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
      await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
      await expect(page.getByText(/trust status/i)).toBeVisible();
      await expect(page.getByText(/complete your verification/i)).toHaveCount(0);
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
      await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
      await expect(page.getByText(/complete your verification/i)).toHaveCount(0);
      await expect(page.getByText(/steps left/i)).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Post", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Post", exact: true })).toHaveAttribute(
        "href",
        "/post/create"
      );
      await expect(page.getByRole("link", { name: "Leads", exact: true })).toHaveAttribute(
        "href",
        "/dashboard/leads"
      );

      expect(errors.consoleErrors).toEqual([]);
      expect(errors.pageErrors).toEqual([]);
    });
  });
});
