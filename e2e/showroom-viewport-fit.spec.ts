import { expect, test } from "@playwright/test";

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
];

for (const viewport of sizes) {
  test(`showroom cards fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of [
      "/",
      "/mzansi-market",
      "/mzansi-business",
      "/tourism-events",
      "/dev/showroom-drag",
    ]) {
      await page.goto(route);
      const showroom = page.locator('section[aria-roledescription="carousel"]').first();
      await expect(showroom).toBeVisible();
      await expect(page.locator("main section").first()).toHaveAttribute(
        "aria-roledescription",
        "carousel"
      );
      const card = showroom
        .locator(
          '[data-showroom-layer="active"], .showroom-card-frame:not(.invisible):not([data-showroom-layer])'
        )
        .first();
      await expect(card).toBeVisible();
      const box = await card.evaluate((el) => {
        const { x, y, width, height } = el.getBoundingClientRect();
        return { x, y, width, height };
      });
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      const header = (await page.locator("header").count())
        ? await page.locator("header").first().boundingBox()
        : null;
      const nav = page.getByRole("navigation", { name: "Main", exact: true });
      const bottom = (await nav.isVisible()) ? (await nav.boundingBox())!.y : viewport.height;
      expect(box!.y).toBeGreaterThanOrEqual(header ? header.y + header.height : 0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(bottom);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      const metadata = card.locator("[data-card-metadata]");
      expect(await metadata.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      if (route === "/dev/showroom-drag") {
        const sizingCard = showroom.locator(".showroom-card-frame.invisible");
        const sizingHeight = await sizingCard.evaluate((el) => el.getBoundingClientRect().height);
        expect(Math.abs(box!.height - sizingHeight)).toBeLessThan(2);
      }
      await page.screenshot({
        path: testInfo.outputPath(`${route.replaceAll("/", "") || "home"}.png`),
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
