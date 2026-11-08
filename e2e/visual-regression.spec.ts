import { test, expect, type Page } from "@playwright/test";
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
};

const screens: readonly Screen[] = [
  { name: "home", path: "/", readySelector: "main:visible" },
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
 * Same browser, fonts and build produce the same pixels, so the allowance only
 * covers anti-aliasing noise at glyph and image edges: each pixel may differ
 * slightly in colour (threshold 0.2 is Playwright's default perceptual
 * distance), and at most 0.1% of a picture may differ beyond that. One changed
 * button or heading colour affects far more pixels and fails the check.
 */
const PICTURE_OPTIONS = {
  fullPage: true,
  animations: "disabled",
  caret: "hide",
  threshold: 0.2,
  maxDiffPixelRatio: 0.001,
  timeout: 20_000,
} as const;

function skipOutsideTheContainer(projectName: string) {
  test.skip(
    process.platform !== "linux",
    "Visual baselines are Linux pictures; run them in the pinned Playwright container"
  );
  test.skip(projectName !== "chromium", "Chromium snapshots are the baseline for this suite.");
}

async function openSettledScreen(page: Page, screen: Screen) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.context().addCookies([
    {
      name: PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
      value: "1",
      url: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100",
    },
  ]);
  await page.goto(screen.path, { waitUntil: "load" });
  await page.locator(screen.readySelector).first().waitFor({ state: "visible" });
  if (screen.settled) {
    await expect(page.locator(screen.settled)).toHaveCount(0);
  }
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
}

for (const width of widths) {
  test.describe(`Chosen frontend at ${width.label} px`, { tag: "@visual" }, () => {
    test.use({ viewport: width.viewport });

    for (const screen of screens) {
      test(screen.name, async ({ page }, testInfo) => {
        skipOutsideTheContainer(testInfo.project.name);
        await openSettledScreen(page, screen);
        await expect(page).toHaveScreenshot(`${screen.name}-${width.label}.png`, PICTURE_OPTIONS);
      });
    }
  });
}

test.describe("Chosen frontend in dark mode at 1280 px", { tag: "@visual" }, () => {
  test.use({ colorScheme: "dark", viewport: { width: 1280, height: 800 } });

  for (const name of darkScreens) {
    const screen = screens.find((item) => item.name === name)!;
    test(screen.name, async ({ page }, testInfo) => {
      skipOutsideTheContainer(testInfo.project.name);
      await openSettledScreen(page, screen);
      await expect(page).toHaveScreenshot(`${screen.name}-dark-1280.png`, PICTURE_OPTIONS);
    });
  }
});
