import { expect, test } from "@playwright/test";

const sizes = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

for (const viewport of sizes) {
  test(`showroom cards fit ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of ["/", "/mzansi-market", "/mzansi-business", "/tourism-events"]) {
      await page.goto(route);
      const showroom = page.locator('section[aria-roledescription="carousel"]').first();
      await expect(showroom).toBeVisible();
      await expect(page.locator("main > section").first()).toHaveAttribute(
        "aria-roledescription",
        "carousel"
      );
      const active = showroom.locator('[data-showroom-layer="active"]');
      const card = (await active.count())
        ? active
        : showroom.locator(".showroom-card-frame").first();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      const header = await page.locator("header").first().boundingBox();
      const nav = page.getByRole("navigation", { name: "Main", exact: true });
      const bottom = (await nav.isVisible()) ? (await nav.boundingBox())!.y : viewport.height;
      expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      expect(box!.y + box!.height).toBeLessThanOrEqual(bottom);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      const metadata = card.locator("[data-card-metadata]");
      expect(await metadata.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${route.replaceAll("/", "") || "home"}.png`),
      });
    }
  });
}
