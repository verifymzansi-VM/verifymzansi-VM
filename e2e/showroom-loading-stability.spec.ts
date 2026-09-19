import { expect, test, type Locator } from "@playwright/test";

const readFrames = (slides: Locator) =>
  slides.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        z: Number(style.zIndex),
      };
    })
  );

for (const viewport of [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
]) {
  test(`showroom is stable before hydration at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/dev/showroom-drag");
    const slides = page.locator("[data-showroom-index]");
    // Inline transforms are installed by the carousel's layout effect.
    await expect(slides.first()).toHaveAttribute("style", /(?:^|;)\s*transform:/);
    const hydrated = await readFrames(slides);
    const image = slides.nth(1).getByAltText("Drag Test Two", { exact: true });
    const originalImage = await image.elementHandle();
    await page.getByLabel("Carousel slides", { exact: true }).press("ArrowRight");
    await expect(page.getByText("Slide 2 of 3", { exact: true })).toBeAttached();
    expect(await image.evaluate((element, original) => element === original, originalImage)).toBe(
      true
    );
    await expect(image).toHaveCSS("opacity", "1");

    // Keep streaming HTML scripts but block the app: CSS and images must stand alone.
    await page.route("**/_next/**/*.js", (route) => route.abort());
    await page.reload();
    await expect(slides.first()).toBeVisible();
    const initial = await readFrames(slides);
    expect(initial).toHaveLength(3);
    expect(initial[0].z).toBeGreaterThan(initial[1].z);
    expect(initial[0].z).toBeGreaterThan(initial[2].z);
    expect(initial[1].width).toBeLessThan(initial[0].width);
    expect(initial[0].x + initial[0].width / 2).toBeCloseTo(viewport.width / 2, 0);
    await expect(image).toHaveCSS("opacity", "1");
    await expect(slides.nth(1).locator(".skeleton-shimmer")).toHaveCount(0);
    for (let i = 0; i < initial.length; i++) {
      for (const key of ["x", "y", "width", "height"] as const) {
        expect(initial[i][key]).toBeCloseTo(hydrated[i][key], 0);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}
