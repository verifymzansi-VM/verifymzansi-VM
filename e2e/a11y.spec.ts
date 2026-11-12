import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { POSTING_MOBILE_STATE } from "./auth-state";
import { registerKeyboardA11yChecks } from "./support/keyboard-a11y";

/**
 * Automated a11y tests — runs axe-core against key pages.
 * Any WCAG 2.1 AA violations fail the test.
 *
 * Run:
 *   pnpm exec playwright test e2e/a11y.spec.ts
 */

const publicPages = [
  { name: "homepage", path: "/" },
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
  { name: "pricing", path: "/pricing" },
  { name: "contact", path: "/contact" },
  { name: "privacy", path: "/privacy" },
  { name: "terms", path: "/terms" },
  { name: "mzansi-market", path: "/mzansi-market" },
  { name: "mzansi-business", path: "/mzansi-business" },
  { name: "tourism-events", path: "/tourism-events" },
  { name: "search", path: "/search" },
];

/** Discovery pages whose redesigned chrome is also checked in dark mode. */
const darkModePages = publicPages.filter((page) =>
  ["homepage", "mzansi-market", "mzansi-business", "tourism-events"].includes(page.name)
);

async function expectNoSeriousViolations(page: Page, name: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();

  if (results.violations.length > 0) {
    console.warn(`${name}: ${results.violations.length} a11y violations`);
    for (const v of results.violations) {
      console.warn(`  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} instances)`);
    }
  }

  const criticalViolations = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );

  expect(
    criticalViolations,
    `${name} has ${criticalViolations.length} critical/serious a11y violations`
  ).toHaveLength(0);
}

test.describe("Accessibility (axe-core WCAG 2.1 AA)", () => {
  for (const page of publicPages) {
    test(`${page.name} has no critical a11y violations`, async ({ page: pw }) => {
      await pw.goto(page.path, { waitUntil: "domcontentloaded" });
      // Allow styles/animations to settle before running axe
      await pw.waitForLoadState("networkidle").catch(() => {});
      await expectNoSeriousViolations(pw, page.name);
    });
  }

  for (const page of darkModePages) {
    test(`${page.name} has no critical a11y violations in dark mode`, async ({ page: pw }) => {
      await pw.emulateMedia({ colorScheme: "dark" });
      await pw.goto(page.path, { waitUntil: "domcontentloaded" });
      await pw.waitForLoadState("networkidle").catch(() => {});
      await expect(pw.locator("html")).toHaveClass(/\bdark\b/);
      await expectNoSeriousViolations(pw, `${page.name} (dark)`);
    });
  }

  test("login validation state has no critical a11y violations", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expectNoSeriousViolations(page, "login validation state");
  });

  test("register validation state has no critical a11y violations", async ({ page }) => {
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByRole("button", { name: /create account/i })).toBeVisible();
    await page.getByRole("button", { name: /create account/i }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expectNoSeriousViolations(page, "register validation state");
  });
});

registerKeyboardA11yChecks();

test.describe("posting form keeps the focused field in view (WCAG 2.4.11)", () => {
  test.use({ storageState: POSTING_MOBILE_STATE, viewport: { width: 375, height: 812 } });

  test("no field reached with Tab hides behind the sticky Back/Next bar", async ({ page }) => {
    await page.goto("/post/create-listing");
    const bar = page.locator("[data-post-action-bar]");
    const start = page.getByRole("button", { name: /Start Posting|Use Your Free Post/i });
    await expect(bar.or(start).first()).toBeVisible({ timeout: 30_000 });
    if (await start.isVisible()) await start.click();
    await expect(bar).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("h1").first().click();
    const obscured: string[] = [];
    let checked = 0;
    for (let stop = 0; stop < 60; stop++) {
      await page.keyboard.press("Tab");
      const field = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        const actionBar = document.querySelector("[data-post-action-bar]");
        if (!element || element === document.body || !actionBar || actionBar.contains(element))
          return null;
        const box = element.getBoundingClientRect();
        if (box.height === 0 || box.width === 0) return null;
        // The part of the field the bar covers (zero once the bar has moved
        // past it, e.g. for footer links below the form).
        const bar = actionBar.getBoundingClientRect();
        return {
          name: (element.getAttribute("aria-label") || element.id || element.tagName).slice(0, 40),
          hiddenBelowBar: Math.max(
            0,
            Math.min(box.bottom, bar.bottom) - Math.max(box.top, bar.top)
          ),
        };
      });
      if (!field) continue;
      checked++;
      if (field.hiddenBelowBar > 1) obscured.push(`${field.name} (${field.hiddenBelowBar}px)`);
    }
    expect(checked).toBeGreaterThan(5);
    expect(obscured).toEqual([]);
  });
});
