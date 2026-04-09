import { expect, test } from "@playwright/test";
import { PLAYWRIGHT_HIDE_FIXTURES_COOKIE } from "@/lib/supabase/playwright-visual-fixtures";

function isMobileProject(projectName: string): boolean {
  return projectName === "mobile-chrome" || projectName === "mobile-safari";
}

const routes = [
  { name: "mzansi-market", path: "/mzansi-market" },
  { name: "mzansi-business", path: "/mzansi-business" },
  { name: "promotions", path: "/promotions" },
] as const;

test.describe("Marketplace showroom CTA touch targets", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo.project.name), "Runs only on mobile projects.");

    await page.context().addCookies([
      {
        name: PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
        value: "1",
        url: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100",
      },
    ]);
  });

  for (const route of routes) {
    test(`${route.name} showroom CTA stays touch-friendly`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.locator("body").waitFor({ state: "visible" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const showroomSection = page.locator("section").first();
      await expect(showroomSection).toBeVisible();

      const showroomCta = showroomSection
        .getByRole("link", {
          name: /view listing|view business|visit shop|view event|list your business|create event/i,
        })
        .first();

      await expect(showroomCta).toBeVisible();

      const box = await showroomCta.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    });
  }
});
