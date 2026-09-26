import { expect, test } from "@playwright/test";
import { PLAYWRIGHT_HIDE_FIXTURES_COOKIE } from "@/lib/supabase/playwright-visual-fixtures";

const routes = [
  {
    name: "mzansi-market",
    path: "/mzansi-market",
    heading: /^mzansi market$/i,
  },
  {
    name: "mzansi-business",
    path: "/mzansi-business",
    heading: /mzansi business/i,
  },
  {
    name: "promotions",
    path: "/tourism-events",
    heading: /tourism & events/i,
  },
] as const;

test.describe("Marketplace showroom smoke", () => {
  for (const route of routes) {
    test(`${route.name} renders showroom without runtime errors`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "This smoke runs in Chromium only.");

      await page.context().addCookies([
        {
          name: PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
          value: "1",
          url: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100",
        },
      ]);

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });

      page.on("pageerror", (error) => {
        pageErrors.push(String(error));
      });

      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await page.locator("body").waitFor({ state: "visible" });
      // Each browse page opens with its AreaHero, which owns the page h1.
      await page
        .getByRole("heading", { level: 1, name: route.heading })
        .first()
        .waitFor({ state: "visible" });
      await page.waitForLoadState("networkidle").catch(() => {});

      // The showroom sits below the intro, so scroll to it like a visitor would.
      const showroomSection = page.locator("section[aria-roledescription='carousel']").first();
      await showroomSection.scrollIntoViewIfNeeded();
      await expect(showroomSection).toBeVisible();

      const showroomCard = showroomSection.getByRole("link").first();
      await showroomCard.scrollIntoViewIfNeeded();
      await expect(showroomCard).toBeVisible();

      const [cardBox, headerBox, viewportHeight] = await Promise.all([
        showroomCard.boundingBox(),
        page.locator("body header").first().boundingBox(),
        page.evaluate(() => window.innerHeight),
      ]);

      expect(cardBox).not.toBeNull();
      expect(cardBox!.height).toBeLessThanOrEqual(
        viewportHeight - (headerBox ? headerBox.height : 0)
      );
      expect(cardBox!.y).toBeGreaterThanOrEqual(0);
      expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(viewportHeight);

      expect(
        consoleErrors.filter((message) =>
          /hydration|runtime|typeerror|referenceerror|server rendered html didn't match/i.test(
            message
          )
        )
      ).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
});
