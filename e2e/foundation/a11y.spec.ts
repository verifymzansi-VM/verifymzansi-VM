import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { registerKeyboardA11yChecks } from "../support/keyboard-a11y";

// axe-core (WCAG 2.1 A/AA) on the public pages of the restored website in
// foundation mode, moved from the stub suite's e2e/a11y.spec.ts (PORTING.md).
// Critical and serious violations fail the test; lesser ones are logged.

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

  for (const v of results.violations) {
    console.warn(`${name}: [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} instances)`);
  }

  const criticalViolations = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious"
  );
  expect(
    criticalViolations.map((v) => ({ id: v.id, targets: v.nodes.map((node) => node.target) })),
    `${name} has ${criticalViolations.length} critical/serious a11y violations`
  ).toEqual([]);
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Let styles and entrance animations settle before axe reads colours.
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Submits the empty form until its errors show: a click before the page
 * hydrated does not run the form's own validation. */
async function submitEmpty(page: Page, submit: Locator) {
  await expect(submit).toBeVisible();
  const alert = page.getByRole("alert").first();
  await expect(async () => {
    await submit.click({ timeout: 2_000 });
    await expect(alert).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("accessibility (axe-core WCAG 2.1 AA)", () => {
  for (const { name, path } of publicPages) {
    test(`${name} has no critical a11y violations`, async ({ page }) => {
      await open(page, path);
      await expectNoSeriousViolations(page, name);
    });
  }

  for (const { name, path } of darkModePages) {
    test(`${name} has no critical a11y violations in dark mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await open(page, path);
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await expectNoSeriousViolations(page, `${name} (dark)`);
    });
  }

  test("login validation state has no critical a11y violations", async ({ page }) => {
    await open(page, "/login");
    await submitEmpty(page, page.getByRole("button", { name: /sign in/i }));
    await expectNoSeriousViolations(page, "login validation state");
  });

  test("register validation state has no critical a11y violations", async ({ page }) => {
    await open(page, "/register");
    await submitEmpty(page, page.getByRole("button", { name: /create account/i }));
    await expectNoSeriousViolations(page, "register validation state");
  });
});

registerKeyboardA11yChecks();
