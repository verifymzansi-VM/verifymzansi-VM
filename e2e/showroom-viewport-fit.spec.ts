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
 * Routes that render a showroom carousel. Browse pages lead with their
 * <AreaHero> (the page h1), so the carousel sits below it rather than being the
 * first section in <main>. The homepage "Spotlight" showroom renders only when
 * it has items (hideWhenEmpty), so it can be absent in fixture-free stub runs.
 */
const routes = [
  { path: "/", optional: true, heroHeading: "Buy, sell and discover with people you can trust." },
  { path: "/mzansi-market", optional: false, heroHeading: /^mzansi market$/i },
  { path: "/mzansi-business", optional: false, heroHeading: /^mzansi business$/i },
  { path: "/tourism-events", optional: false, heroHeading: /^tourism & events$/i },
  { path: "/dev/showroom-drag", optional: false, heroHeading: null },
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

      if (route.heroHeading) {
        // The page intro (HomeHero / AreaHero) owns the h1 and comes first.
        const h1 = main.getByRole("heading", { level: 1, name: route.heroHeading });
        await expect(h1).toBeVisible();
      }

      if (route.optional) {
        await page.waitForLoadState("networkidle").catch(() => {});
        if ((await showroom.count()) === 0) {
          // hideWhenEmpty: no empty carousel shell and no orphaned Spotlight heading.
          await expect(main.getByRole("heading", { name: "Trending across Mzansi" })).toHaveCount(
            0
          );
          continue;
        }
      }

      await expect(showroom).toBeAttached();
      if (route.heroHeading) {
        // The carousel follows the intro rather than leading the page.
        const h1 = main.getByRole("heading", { level: 1 }).first();
        const followsHero = await h1.evaluate(
          (heading, section) =>
            !!section &&
            !!(heading.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING),
          await showroom.elementHandle()
        );
        expect(followsHero).toBe(true);
      }

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
        // Matches --showroom-card-width (260px), the mobile card width cap in globals.css.
        expect(box.width).toBeCloseTo(260, 0);
      }
      const showroomBox = await rectOf(showroom);
      expect(box.y).toBeGreaterThanOrEqual(showroomBox.y);
      expect(box.y + box.height).toBeLessThanOrEqual(showroomBox.y + showroomBox.height);
      const metadata = card.locator("[data-card-metadata]");
      expect(await metadata.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      const metadataBox = await rectOf(metadata);
      expect(metadataBox.y + metadataBox.height).toBeLessThanOrEqual(box.y + box.height);
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
