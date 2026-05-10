import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { PLAYWRIGHT_HIDE_FIXTURES_COOKIE } from "@/lib/supabase/playwright-visual-fixtures";

/**
 * Visual regression tests — captures key page screenshots and compares
 * against baseline snapshots.
 *
 * Refresh baselines:
 *   pnpm exec playwright test e2e/visual-regression.spec.ts --update-snapshots
 */

const publicRoutes = [
  {
    name: "homepage",
    path: "/",
    readySelector: "main:visible",
  },
  {
    name: "mzansi-market",
    path: "/mzansi-market",
    readySelector:
      '[data-testid="mzansi-market-grid-ready"], [data-testid="mzansi-market-grid-empty"]',
  },
  {
    name: "mzansi-business",
    path: "/mzansi-business",
    readySelector:
      '[data-testid="mzansi-business-grid-ready"], [data-testid="mzansi-business-grid-empty"]',
  },
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
  { name: "pricing", path: "/pricing", readySelector: "main:visible" },
  { name: "contact", path: "/contact", readySelector: "main:visible" },
  { name: "privacy", path: "/privacy", readySelector: "main:visible" },
  { name: "terms", path: "/terms", readySelector: "main:visible" },
] as const;

async function gotoAndWaitForStablePage(page: Page, route: (typeof publicRoutes)[number]) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.context().addCookies([
    {
      name: PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
      value: "1",
      url: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100",
    },
  ]);
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await page.locator("body").waitFor({ state: "visible" });
  await page.locator(route.readySelector).first().waitFor({ state: "visible" });

  if (route.name === "mzansi-market") {
    await page.waitForFunction(() => {
      return (
        !document.querySelector('[data-testid="mzansi-market-grid-loading"]') &&
        !!document.querySelector(
          '[data-testid="mzansi-market-grid-ready"], [data-testid="mzansi-market-grid-empty"]'
        )
      );
    });
  }

  if (route.name === "mzansi-business") {
    await page.waitForFunction(() => {
      return (
        !document.querySelector('[data-testid="mzansi-business-grid-loading"]') &&
        !!document.querySelector(
          '[data-testid="mzansi-business-grid-ready"], [data-testid="mzansi-business-grid-empty"]'
        )
      );
    });
  }

  await page.evaluate(async () => {
    // Wait for fonts to be ready
    if (document.fonts) {
      await document.fonts.ready;
    }
    const images = Array.from(document.images).filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    await Promise.all(
      images.map((image) => {
        if (image.complete && image.naturalWidth > 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        });
      })
    );
    // Pause all video elements and reset to frame 0 for deterministic captures
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      video.pause();
      video.currentTime = 0;
    }
    // Disable CSS animations/transitions for stable screenshots
    const style = document.createElement("style");
    style.textContent = `*, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }`;
    document.head.appendChild(style);
  });
  // Small settle wait after pausing media and disabling animations
  await page.waitForTimeout(300);
}

test.describe("Visual Regression — Desktop", () => {
  for (const route of publicRoutes) {
    test(`${route.name}`, async ({ page }, testInfo) => {
      const isUpdatingSnapshots = testInfo.config.updateSnapshots !== "none";
      test.skip(
        !!process.env.CI,
        "Visual regression baselines are platform-specific — skipped in CI"
      );
      test.skip(
        testInfo.project.name !== "chromium",
        "Chromium snapshots are the baseline for this suite."
      );
      const snapshotPath = testInfo.snapshotPath(`${route.name}-desktop.png`);
      test.skip(
        !isUpdatingSnapshots && !existsSync(snapshotPath),
        `Missing baseline snapshot: ${snapshotPath}`
      );
      await gotoAndWaitForStablePage(page, route);

      await expect(page).toHaveScreenshot(`${route.name}-desktop.png`, {
        fullPage: true,
        maxDiffPixelRatio: route.name === "homepage" ? 0.1 : 0.01,
        timeout: 15_000,
      });
    });
  }
});

test.describe("Visual Regression — Mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const mobilePages = publicRoutes.filter((r) =>
    ["homepage", "login", "mzansi-market", "mzansi-business", "pricing"].includes(r.name)
  );

  for (const route of mobilePages) {
    test(`${route.name}`, async ({ page }, testInfo) => {
      const isUpdatingSnapshots = testInfo.config.updateSnapshots !== "none";
      test.skip(
        !!process.env.CI,
        "Visual regression baselines are platform-specific — skipped in CI"
      );
      test.skip(
        testInfo.project.name !== "chromium",
        "Chromium snapshots are the baseline for this suite."
      );
      const snapshotPath = testInfo.snapshotPath(`${route.name}-mobile.png`);
      test.skip(
        !isUpdatingSnapshots && !existsSync(snapshotPath),
        `Missing baseline snapshot: ${snapshotPath}`
      );
      await gotoAndWaitForStablePage(page, route);

      await expect(page).toHaveScreenshot(`${route.name}-mobile.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        timeout: 15_000,
      });
    });
  }
});

test.describe("Visual Regression — Dark Mode", () => {
  test.use({ colorScheme: "dark" });

  for (const name of ["homepage", "login", "pricing"]) {
    const route = publicRoutes.find((r) => r.name === name)!;
    test(`${route.name}`, async ({ page }, testInfo) => {
      const isUpdatingSnapshots = testInfo.config.updateSnapshots !== "none";
      test.skip(
        !!process.env.CI,
        "Visual regression baselines are platform-specific — skipped in CI"
      );
      test.skip(
        testInfo.project.name !== "chromium",
        "Chromium snapshots are the baseline for this suite."
      );
      const snapshotPath = testInfo.snapshotPath(`${route.name}-dark.png`);
      test.skip(
        !isUpdatingSnapshots && !existsSync(snapshotPath),
        `Missing baseline snapshot: ${snapshotPath}`
      );
      await gotoAndWaitForStablePage(page, route);

      await expect(page).toHaveScreenshot(`${route.name}-dark.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
        timeout: 15_000,
      });
    });
  }
});
