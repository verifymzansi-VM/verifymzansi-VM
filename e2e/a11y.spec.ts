import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
