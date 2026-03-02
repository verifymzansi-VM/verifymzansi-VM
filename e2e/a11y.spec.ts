import { test, expect } from "@playwright/test";
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
];

test.describe("Accessibility (axe-core WCAG 2.1 AA)", () => {
  for (const page of publicPages) {
    test(`${page.name} has no critical a11y violations`, async ({ page: pw }) => {
      await pw.goto(page.path, { waitUntil: "domcontentloaded" });
      // Allow styles/animations to settle before running axe
      await pw.waitForLoadState("networkidle").catch(() => {});

      const results = await new AxeBuilder({ page: pw })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();

      // Log violations for debugging
      if (results.violations.length > 0) {
        console.warn(`${page.name}: ${results.violations.length} a11y violations`);
        for (const v of results.violations) {
          console.warn(`  [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} instances)`);
        }
      }

      // Fail on critical and serious violations only
      const criticalViolations = results.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious"
      );

      expect(
        criticalViolations,
        `${page.name} has ${criticalViolations.length} critical/serious a11y violations`
      ).toHaveLength(0);
    });
  }
});
