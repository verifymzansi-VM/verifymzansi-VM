import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { registerKeyboardA11yChecks } from "../support/keyboard-a11y";
import { browserSessionCookies, readTestCopy } from "./support/test-copy";
import { registerVerifiedMember } from "./support/verified-member";

// axe-core (WCAG 2.1 A/AA) on the public pages of the restored website in
// foundation mode, moved from the stub suite's e2e/a11y.spec.ts (PORTING.md).
// Critical and serious violations fail the test; lesser ones are logged.
// Also moved from there: the posting form's focused field stays clear of the
// sticky Back/Next bar, for a new verified member per run.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

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

test.describe("posting form keeps the focused field in view (WCAG 2.4.11)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("no field reached with Tab hides behind the sticky Back/Next bar", async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    const member = await registerVerifiedMember("focus-in-view");
    const session = await browserSessionCookies(readTestCopy(), member);
    await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));

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
