import { expect, test } from "@playwright/test";
import { PLAYWRIGHT_HIDE_FIXTURES_COOKIE } from "@/lib/supabase/playwright-visual-fixtures";

const routes = [
  {
    name: "mzansi-market",
    path: "/mzansi-market",
    heading: /browse listings/i,
  },
  {
    name: "mzansi-business",
    path: "/mzansi-business",
    heading: /mzansi business/i,
  },
  {
    name: "promotions",
    path: "/promotions",
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
      await page
        .getByRole("heading", { name: route.heading })
        .first()
        .waitFor({ state: "visible" });
      await page.waitForLoadState("networkidle").catch(() => {});

      const showroomSection = page.locator("section").first();
      await expect(showroomSection).toBeVisible();

      const showroomCta = showroomSection
        .getByRole("link", {
          name: /view listing|view business|visit shop|view event|list your business|create event/i,
        })
        .first();

      await expect(showroomCta).toBeVisible();

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
