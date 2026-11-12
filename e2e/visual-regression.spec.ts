import { test, expect, type Page } from "@playwright/test";
import { SHOWROOM_PROVINCE_ALL, SHOWROOM_PROVINCE_COOKIE } from "@/lib/showroom/province-cookie";
import { PLAYWRIGHT_HIDE_FIXTURES_COOKIE } from "@/lib/supabase/playwright-visual-fixtures";

/**
 * Picture checks for the frontend the owner chose (commit 0b562f42, restored
 * on 27 October 2026). Each screen is compared with an approved Linux picture
 * in visual-regression.spec.ts-snapshots/ (`*-chromium-linux.png`).
 *
 * The pictures are only meaningful inside the pinned Playwright container
 * (see the "visual-regression" job in .github/workflows/ci.yml): the same
 * browser build and fonts as when the baselines were made. Other operating
 * systems render text differently, so the checks skip there.
 *
 * Never refresh the pictures from today's code to make the check pass. A new
 * picture needs the owner's approval on its pull request (roadmap M0.12/M0.13).
 */

type Screen = {
  name: string;
  path: string;
  readySelector: string;
  /** Extra condition that must hold before the picture is taken. */
  settled?: string;
  /** Decorative elements left out of the picture (see SHOWROOM_CARD_BACKDROP). */
  hideInPicture?: string;
};

/**
 * The enlarged backdrop copy of the home showroom card's artwork
 * (SmartFitBackdrop in src/components/ui/video-card-player.tsx). Chromium draws
 * the large text inside that scaled SVG in one of two ways from one page load
 * to the next, so the same build gave home-800 46 and home-1280 23 differing
 * pixels in about one CI run in ten. The card, its front artwork and the rest of
 * the page are still compared; only this duplicate is hidden in the picture.
 */
const SHOWROOM_CARD_BACKDROP = '[data-media-fit="smart"] > img[aria-hidden="true"]';

const screens: readonly Screen[] = [
  { name: "home", path: "/", readySelector: "main:visible", hideInPicture: SHOWROOM_CARD_BACKDROP },
  {
    name: "mzansi-market",
    path: "/mzansi-market",
    readySelector:
      '[data-testid="mzansi-market-grid-ready"], [data-testid="mzansi-market-grid-empty"]',
    settled: '[data-testid="mzansi-market-grid-loading"]',
  },
  {
    name: "mzansi-business",
    path: "/mzansi-business",
    readySelector:
      '[data-testid="mzansi-business-grid-ready"], [data-testid="mzansi-business-grid-empty"]',
    settled: '[data-testid="mzansi-business-grid-loading"]',
  },
  { name: "tourism-events", path: "/tourism-events", readySelector: "main:visible" },
  // A post address. The test stand-in holds no posts until a test creates one,
  // so this is the page every missing or removed post shows.
  { name: "post-not-found", path: "/listing/e2e-missing-listing", readySelector: "main:visible" },
  { name: "pricing", path: "/pricing", readySelector: "main:visible" },
  {
    name: "login",
    path: "/login",
    readySelector: 'form:visible, h1:has-text("Sign in"):visible',
  },
  {
    name: "register",
    path: "/register",
    readySelector: 'form:visible, h1:has-text("Create your account"):visible',
  },
  { name: "contact", path: "/contact", readySelector: "main:visible" },
  { name: "trust-safety", path: "/trust-safety", readySelector: "main:visible" },
];

/** Phone, tablet and desktop widths agreed for the chosen frontend (OD-04). */
const widths = [
  { label: "375", viewport: { width: 375, height: 812 } },
  { label: "800", viewport: { width: 800, height: 1024 } },
  { label: "1280", viewport: { width: 1280, height: 800 } },
] as const;

const darkScreens = ["home", "pricing", "login"] as const;

/**
 * Same image, browser, fonts and build give near-identical pixels: repeat runs
 * differ by at most 2 of 255 in a colour channel, in a few dozen pixels of
 * soft gradients and shadows. The allowance covers only that noise:
 *
 * - threshold 0.05: per-pixel perceptual colour distance (pixelmatch YIQ;
 *   Playwright's default 0.2 is so loose that it passed the brand green
 *   #0b7a55 turned teal-blue #0b557a);
 * - maxDiffPixels 20: pixels beyond that distance. One changed button, text
 *   or colour affects hundreds or thousands of pixels and fails the check.
 *
 * Anti-aliased edge pixels are already ignored by the comparison.
 */
const PICTURE_OPTIONS = {
  animations: "disabled",
  caret: "hide",
  threshold: 0.05,
  maxDiffPixels: 20,
  timeout: 20_000,
} as const;

function skipOutsideTheContainer(projectName: string) {
  test.skip(
    process.platform !== "linux",
    "Visual baselines are Linux pictures; run them in the pinned Playwright container"
  );
  test.skip(projectName !== "chromium", "Chromium snapshots are the baseline for this suite.");
}

/** Opens the screen, lets it settle and returns the picture options for it. */
async function openSettledScreen(
  page: Page,
  screen: Screen,
  viewport: { width: number; height: number }
) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const url = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
  await page.context().addCookies([
    { name: PLAYWRIGHT_HIDE_FIXTURES_COOKIE, value: "1", url },
    // The showroom otherwise guesses the visitor's province from the network,
    // so a picture taken in South Africa would differ from one taken in CI.
    { name: SHOWROOM_PROVINCE_COOKIE, value: SHOWROOM_PROVINCE_ALL, url },
  ]);
  await page.goto(screen.path, { waitUntil: "load" });
  await page.locator(screen.readySelector).first().waitFor({ state: "visible" });
  if (screen.settled) {
    await expect(page.locator(screen.settled)).toHaveCount(0);
  }
  await page.waitForLoadState("networkidle");
  const fits = await fitWindowToPage(page, viewport);
  await page.waitForLoadState("networkidle");

  await page.evaluate(async () => {
    if (document.fonts) {
      await document.fonts.ready;
    }
    const images = Array.from(document.images).filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    await Promise.all(
      images.map((image) => {
        // A finished image (loaded or already failed) never fires load/error
        // again, and an offscreen lazy image may never start; bound the wait
        // so neither hangs the capture until the test timeout.
        if (image.complete) return Promise.resolve();
        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, 10_000);
        });
      })
    );
    for (const video of document.querySelectorAll("video")) {
      video.pause();
      video.currentTime = 0;
    }
  });
  if (screen.hideInPicture) await hideInPicture(page, screen.hideInPicture);
  return { ...PICTURE_OPTIONS, fullPage: !fits };
}

/**
 * Hides decorative elements before the picture is taken. The site's
 * Content-Security-Policy blocks style tags without its nonce, which includes
 * the one Playwright's `style` screenshot option adds, so the rule goes in a
 * constructed style sheet instead (not subject to that policy).
 */
async function hideInPicture(page: Page, selector: string) {
  // If the page no longer has the element, say so instead of failing on pixels.
  await expect(page.locator(selector)).not.toHaveCount(0);
  await page.evaluate((target) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`${target} { visibility: hidden !important; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, selector);
  await nextFrames(page);
}

/** How much a page may grow when the window is made as tall as the page. */
const MAX_FIT_GROWTH = 64;

const pageHeight = (page: Page) =>
  page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));

const nextFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );

/**
 * Returns whether the whole page now fits the window.
 *
 * A full-page capture briefly resizes the window, and the filter tab on the
 * right edge (phones and tablets) re-positions itself on every resize, so a
 * full-page picture of a list page changes from one capture to the next.
 * Instead the window is made as tall as the page once, the page settles, and
 * the picture is an ordinary capture with no further resizing. Fixed controls
 * then sit where they would on a screen that tall. Pages whose banners grow
 * with the window (home everywhere, the list pages at 1280 px) keep the normal
 * window and a full-page capture; none of them shows the filter tab.
 */
async function fitWindowToPage(page: Page, viewport: { width: number; height: number }) {
  const natural = await pageHeight(page);
  if (natural <= viewport.height) return true;
  // A phone list page grows a few pixels once (its frame fills the window);
  // a page whose banners are sized to the window grows a lot and would no
  // longer look like the real screen, so it keeps the normal window.
  let height = natural;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(250);
    await nextFrames(page);
    const grown = await pageHeight(page);
    if (grown === height) return true;
    if (grown > natural + MAX_FIT_GROWTH) break;
    height = grown;
  }
  await page.setViewportSize(viewport);
  await nextFrames(page);
  return false;
}

for (const width of widths) {
  test.describe(`Chosen frontend at ${width.label} px`, { tag: "@visual" }, () => {
    test.use({ viewport: width.viewport });

    for (const screen of screens) {
      test(screen.name, async ({ page }, testInfo) => {
        skipOutsideTheContainer(testInfo.project.name);
        const options = await openSettledScreen(page, screen, width.viewport);
        await expect(page).toHaveScreenshot(`${screen.name}-${width.label}.png`, options);
      });
    }
  });
}

test.describe("Chosen frontend in dark mode at 1280 px", { tag: "@visual" }, () => {
  const viewport = { width: 1280, height: 800 };
  test.use({ colorScheme: "dark", viewport });

  for (const name of darkScreens) {
    const screen = screens.find((item) => item.name === name)!;
    test(screen.name, async ({ page }, testInfo) => {
      skipOutsideTheContainer(testInfo.project.name);
      const options = await openSettledScreen(page, screen, viewport);
      await expect(page).toHaveScreenshot(`${screen.name}-dark-1280.png`, options);
    });
  }
});
