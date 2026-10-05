import { expect, test, type Locator, type Page } from "@playwright/test";

const sizes = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 1366, height: 600 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/**
 * Routes that render a showroom carousel. The showroom is the first thing on
 * every one of these pages, so there is no intro heading to wait for. The
 * homepage showroom falls back to a welcome card when it has no items, which
 * is not a carousel, so it is optional in fixture-free stub runs.
 */
const routes = [
  { path: "/", optional: true },
  { path: "/mzansi-market", optional: false },
  { path: "/mzansi-business", optional: false },
  { path: "/tourism-events", optional: false },
  { path: "/dev/showroom-drag", optional: false },
] as const;

type Box = { x: number; y: number; width: number; height: number };

async function rectOf(locator: Locator): Promise<Box> {
  return locator.evaluate((el) => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  });
}

/** Bottom edge of the usable viewport: the fixed mobile tab bar when it is showing. */
async function usableBottom(page: Page, viewportHeight: number): Promise<number> {
  const nav = page.getByRole("navigation", { name: "Main", exact: true });
  if ((await nav.count()) === 0 || !(await nav.isVisible())) return viewportHeight;
  return (await rectOf(nav)).y;
}

/** Bottom edge of the sticky site header (two rows: actions + area tabs). */
async function usableTop(page: Page): Promise<number> {
  const header = page.locator("body header").first();
  if ((await header.count()) === 0 || !(await header.isVisible())) return 0;
  const box = await rectOf(header);
  return Math.max(0, box.y + box.height);
}

/**
 * Scroll so the card sits in the middle of the space left between the sticky
 * header and the bottom tab bar, the way a visitor would scroll to it.
 */
async function scrollCardIntoUsableArea(page: Page, card: Locator, viewportHeight: number) {
  await card.scrollIntoViewIfNeeded();
  const top = await usableTop(page);
  const bottom = await usableBottom(page, viewportHeight);
  const box = await rectOf(card);
  const slack = bottom - top - box.height;
  const delta = box.y - (top + Math.max(0, slack / 2));
  await page.evaluate((dy) => window.scrollBy(0, dy), delta);
  // Let sticky/fixed chrome settle after the programmatic scroll.
  await page.waitForTimeout(50);
}

for (const viewport of sizes) {
  test(`showroom cards fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of routes) {
      await page.goto(route.path);
      const main = page.locator("main");
      const showroom = main.locator('section[aria-roledescription="carousel"]').first();

      if (route.optional) {
        await page.waitForLoadState("networkidle").catch(() => {});
        if ((await showroom.count()) === 0) {
          continue;
        }
      }

      await expect(showroom).toBeAttached();
      // The cards stream in and replace the loading showroom; measure the final one.
      await expect(showroom.locator('[role="status"][aria-busy="true"]')).toHaveCount(0);
      await showroom.scrollIntoViewIfNeeded();
      await expect(showroom).toBeVisible();
      const card = showroom
        .locator(
          '[data-showroom-layer="active"], .showroom-card-frame:not(.invisible):not([data-showroom-layer])'
        )
        .first();
      await expect(card).toBeVisible();
      await expect.poll(async () => (await rectOf(card)).width).toBeGreaterThan(0);

      await scrollCardIntoUsableArea(page, card, viewport.height);

      const box = await rectOf(card);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      // The whole card fits between the sticky header and the bottom tab bar.
      const top = await usableTop(page);
      const bottom = await usableBottom(page, viewport.height);
      expect(box.y).toBeGreaterThanOrEqual(top - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(bottom + 1);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      const mediaBox = await rectOf(card.locator("[data-card-media]").first());
      // The portrait video must fill its frame without the widened side bars.
      // Landscape phone layouts switch the card to a side-by-side grid (globals.css
      // @media (min-width: 640px) and (max-height: 500px)), so the media no longer
      // keeps the 9:16 aspect there.
      const landscapeLayout = viewport.width >= 640 && viewport.height <= 500;
      if (!landscapeLayout) {
        expect(Math.abs(mediaBox.width - (mediaBox.height * 9) / 16)).toBeLessThan(1);
      }
      if (viewport.width === 390 && viewport.height === 844) {
        // Tall phones grow the card to the height left under the header (globals.css
        // --showroom-reserved-height), still leaving the side cards room to peek in.
        expect(box.width).toBeGreaterThan(300);
        expect(box.width).toBeLessThanOrEqual(viewport.width - 72 + 1);
      }
      const showroomBox = await rectOf(showroom);
      expect(box.y).toBeGreaterThanOrEqual(showroomBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(showroomBox.y + showroomBox.height);
      // Logo, title and place sit in a row under the media and stay inside the card.
      const metadataBox = await rectOf(card.locator("[data-card-metadata]").first());
      expect(metadataBox.height).toBeGreaterThan(0);
      expect(metadataBox.y).toBeGreaterThanOrEqual(mediaBox.y + mediaBox.height - 1);
      expect(metadataBox.y + metadataBox.height).toBeLessThanOrEqual(box.y + box.height + 1);
      if (route.path === "/dev/showroom-drag") {
        const sizingCard = showroom.locator(".showroom-card-frame.invisible");
        const sizingHeight = await sizingCard.evaluate((el) => el.getBoundingClientRect().height);
        expect(Math.abs(box.height - sizingHeight)).toBeLessThan(2);
      }
      await page.screenshot({
        path: testInfo.outputPath(`${route.path.replaceAll("/", "") || "home"}.png`),
      });
    }
  });
}

test("South African flag badge is clear in both themes", async ({ page }, testInfo) => {
  await page.goto("/");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.classList.toggle("dark", value === "dark");
      document.documentElement.classList.toggle("light", value === "light");
    }, theme);
    const badge = page.getByRole("img", { name: "South African flag" }).locator("..");
    await expect(badge).toContainText("Made in South Africa");
    await badge.screenshot({ path: testInfo.outputPath(`flag-${theme}.png`) });
  }
});
