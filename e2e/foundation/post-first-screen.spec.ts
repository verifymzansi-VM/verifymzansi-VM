import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  FIRST_SCREEN_EXPECTED,
  type FirstScreenType,
} from "../../src/app/dev/post-first-screen/fixtures";

// The post pages' first phone screen (roadmap M10.6): at 375 x 667 px the
// showroom card's price, title and place sit on the main photo, clear of the
// sticky header and the sticky contact bar, for a market listing (photo and
// video), a business and an event. The caption repeats the page heading, so
// screen readers skip it and hear the title once. The page is the browser-test
// copy of the three post pages, /dev/post-first-screen (test mode only; same
// header, breadcrumbs and detail content as the real pages, fixed posts).

const PHONES = [
  { width: 375, height: 667 },
  { width: 412, height: 915 },
] as const;
const TYPES = Object.keys(FIRST_SCREEN_EXPECTED) as FirstScreenType[];

/** The band of the screen nothing sticky covers: under the header, above the contact bar. */
async function clearBand(page: Page) {
  return page.evaluate(() => {
    let top = 0;
    let bottom = window.innerHeight;
    for (const element of document.querySelectorAll<HTMLElement>("header, body *")) {
      const style = getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const box = element.getBoundingClientRect();
      if (box.height === 0 || box.height > window.innerHeight / 2) continue;
      if (box.top <= 0) top = Math.max(top, box.bottom);
      else if (box.bottom >= window.innerHeight - 1) bottom = Math.min(bottom, box.top);
    }
    return { top, bottom };
  });
}

async function expectInBand(locator: Locator, band: { top: number; bottom: number }, what: string) {
  const box = await locator.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  expect(box!.width, `${what} is not shown`).toBeGreaterThan(1);
  expect(box!.y, `${what} starts under the header`).toBeGreaterThanOrEqual(band.top);
  expect(box!.y + box!.height, `${what} ends under the contact bar`).toBeLessThanOrEqual(
    band.bottom
  );
}

for (const viewport of PHONES) {
  test.describe(`post page first screen at ${viewport.width} x ${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    for (const type of TYPES) {
      test(`${type}: price, title and place on the photo, heard once`, async ({ page }) => {
        const expected = FIRST_SCREEN_EXPECTED[type];
        const response = await page.goto(`/dev/post-first-screen?type=${type}`);
        expect(response?.status()).toBe(200);
        const caption = page.locator("main [data-post-caption]");
        await expect(caption).toBeVisible();
        const band = await clearBand(page);

        await expectInBand(
          caption.getByText(expected.title, { exact: true }),
          band,
          "the title on the photo"
        );
        if (expected.price) {
          await expectInBand(
            caption.getByText(expected.price, { exact: false }),
            band,
            "the price on the photo"
          );
        }

        // Screen readers skip the caption and hear the title once, in the page heading.
        await expect(caption).toHaveAttribute("aria-hidden", "true");
        await expect(page.getByRole("heading", { name: expected.title, exact: true })).toHaveCount(
          1
        );

        // At least 65% black under the white text: 7:1 even on a white photo.
        const shading = await caption.evaluate(
          (element) => getComputedStyle(element).backgroundImage
        );
        expect(shading).toContain("rgba(0, 0, 0, 0.65)");

        // Never twice on one screen: the heading's first line is off the screen or under the bar.
        const headingFirstLineShown = await page.locator("main h1").evaluate((heading) => {
          const box = heading.getBoundingClientRect();
          const lineHeight = parseFloat(getComputedStyle(heading).lineHeight) || box.height;
          const middle = box.top + Math.min(lineHeight, box.height) / 2;
          if (middle >= window.innerHeight) return false;
          const found = document.elementFromPoint(box.left + box.width / 2, middle);
          return Boolean(found && heading.contains(found));
        });
        expect(
          headingFirstLineShown,
          "the page heading repeats the title on the first screen"
        ).toBe(false);
      });
    }
  });
}

test("the caption stays off wider screens, where the heading is beside or under the photo", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const type of ["listing", "event"] as const) {
    await page.goto(`/dev/post-first-screen?type=${type}`);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(page.locator("main [data-post-caption]")).toBeHidden();
  }
});
