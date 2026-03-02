import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

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
    readySelector: 'h1:has-text("Ready to join Mzansi\'s most trusted marketplace?")',
  },
  {
    name: "mzansi-market",
    path: "/mzansi-market",
    readySelector: 'h1:has-text("Browse Listings")',
  },
  {
    name: "business-ads",
    path: "/business-ads",
    readySelector: 'h1:has-text("Professional Directory")',
  },
  { name: "mall-shops", path: "/mall-shops", readySelector: 'h1:has-text("Featured Malls")' },
  { name: "login", path: "/login", readySelector: 'h1:has-text("Sign in to your account")' },
  {
    name: "register",
    path: "/register",
    readySelector: 'h1:has-text("Create your seller account")',
  },
  { name: "pricing", path: "/pricing", readySelector: 'h1:has-text("Pricing")' },
  { name: "contact", path: "/contact", readySelector: 'h1:has-text("Contact Us")' },
  { name: "privacy", path: "/privacy", readySelector: 'h1:has-text("Privacy Policy")' },
  { name: "terms", path: "/terms", readySelector: 'h1:has-text("Terms of Service")' },
] as const;

async function gotoAndWaitForStablePage(page: Page, route: (typeof publicRoutes)[number]) {
  await page.goto(route.path, { waitUntil: "domcontentloaded" });
  await page.locator("main").first().waitFor({ state: "visible" });
  await page.locator(route.readySelector).first().waitFor({ state: "visible" });
  await page.evaluate(async () => {
    // Wait for fonts to be ready
    if (document.fonts) {
      await document.fonts.ready;
    }
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
      test.skip(
        !!process.env.CI,
        "Visual regression baselines are platform-specific — skipped in CI"
      );
      test.skip(
        testInfo.project.name !== "chromium",
        "Chromium snapshots are the baseline for this suite."
      );
      const snapshotPath = testInfo.snapshotPath(`${route.name}-desktop.png`);
      test.skip(!existsSync(snapshotPath), `Missing baseline snapshot: ${snapshotPath}`);
      await gotoAndWaitForStablePage(page, route);

      await expect(page).toHaveScreenshot(`${route.name}-desktop.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

test.describe("Visual Regression — Mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const mobilePages = publicRoutes.filter((r) =>
    ["homepage", "login", "mzansi-market", "pricing"].includes(r.name)
  );

  for (const route of mobilePages) {
    test(`${route.name}`, async ({ page }, testInfo) => {
      test.skip(
        !!process.env.CI,
        "Visual regression baselines are platform-specific — skipped in CI"
      );
      test.skip(
        testInfo.project.name !== "chromium",
        "Chromium snapshots are the baseline for this suite."
      );
      const snapshotPath = testInfo.snapshotPath(`${route.name}-mobile.png`);
      test.skip(!existsSync(snapshotPath), `Missing baseline snapshot: ${snapshotPath}`);
      await gotoAndWaitForStablePage(page, route);

      await expect(page).toHaveScreenshot(`${route.name}-mobile.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});

test.describe("Visual Regression — Dark Mode", () => {
  test.use({ colorScheme: "dark" });

  for (const name of ["homepage", "login", "pricing"]) {
    const route = publicRoutes.find((r) => r.name === name)!;
    test(`${route.name}`, async ({ page }, testInfo) => {
      test.skip(
        !!process.env.CI,
        "Visual regression baselines are platform-specific — skipped in CI"
      );
      test.skip(
        testInfo.project.name !== "chromium",
        "Chromium snapshots are the baseline for this suite."
      );
      const snapshotPath = testInfo.snapshotPath(`${route.name}-dark.png`);
      test.skip(!existsSync(snapshotPath), `Missing baseline snapshot: ${snapshotPath}`);
      await gotoAndWaitForStablePage(page, route);

      await expect(page).toHaveScreenshot(`${route.name}-dark.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.01,
      });
    });
  }
});
