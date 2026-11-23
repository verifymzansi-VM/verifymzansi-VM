import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import people from "./fixture/people.json";
import { browserSessionCookies, queryTestCopy, readTestCopy } from "./support/test-copy";

// Pictures for the owner (launch checklist item 71): pages shown since the
// feature switches went on that the visual baselines do not cover. Runs only
// in the launch-configuration lane (playwright.launch-config.config.ts; the
// ordinary foundation config ignores this file), whose CI job keeps its
// test-results folder as an artifact: each picture is saved there as
// owner-pictures-<name>.png. It compares nothing; it fails only when a page
// does not open. Browser-test builds never show the pre-launch pop-up, which
// production still shows over every page.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const PHONE = { width: 375, height: 812 };

async function signIn(context: BrowserContext) {
  const session = await browserSessionCookies(readTestCopy(), "verifiedMember");
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
}

async function picture(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Let entrance animations finish.
  await page.waitForTimeout(1_500);
  await page.screenshot({
    path: test.info().outputPath(`owner-pictures-${name}.png`),
    fullPage: true,
  });
}

async function open(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), path).toBeLessThan(400);
  expect(new URL(page.url()).pathname, "not sent elsewhere").toBe(path);
}

test.beforeAll(() => {
  expect(process.env.VERIFYMZANSI_LAUNCH_CONFIG, "run with the launch config").toBe("1");
});

test.describe("owner pictures at 1280 px", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("advertise-1280", async ({ page }) => {
    await open(page, "/advertise");
    await picture(page, "advertise-1280");
  });
});

test.describe("owner pictures at 375 px", () => {
  test.use({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test("advertise-375", async ({ page }) => {
    await open(page, "/advertise");
    await picture(page, "advertise-375");
  });

  test("sponsors-375", async ({ page }) => {
    await open(page, "/sponsors");
    await picture(page, "sponsors-375");
  });

  test("pricing-multi-listing-tab-375", async ({ page }) => {
    await open(page, "/pricing");
    const tab = page.getByRole("tablist", { name: "Offers" }).getByRole("tab", {
      name: "Multi-listing",
    });
    // Tapped again until the page has hydrated and the tab takes it.
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await picture(page, "pricing-multi-listing-tab-375");
  });

  test("pricing-multi-listing-375", async ({ page }) => {
    await open(page, "/pricing/multi-listing");
    await picture(page, "pricing-multi-listing-375");
  });

  test("profile-account-375", async ({ context, page }) => {
    await signIn(context);
    await open(page, "/dashboard/profile");
    const tab = page.getByRole("tab", { name: "Account" });
    await expect(async () => {
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
    await picture(page, "profile-account-375");
  });

  test("partner-375", async ({ context, page }) => {
    // The partner page needs a partner: the verified test member becomes one
    // in this throwaway copy for the picture, and stops being one after.
    const email = people.verifiedMember.email.replace(/'/g, "''");
    queryTestCopy(
      "insert into private.partners (account_id, code, status, created_by) " +
        `select u.id, 'OWNERPICS', 'active', u.id from auth.users u where u.email = '${email}' ` +
        "on conflict (account_id) do nothing;"
    );
    try {
      await signIn(context);
      await open(page, "/dashboard/partner");
      await expect(page.getByRole("region", { name: "This month" })).toBeVisible();
      await picture(page, "partner-375");
    } finally {
      try {
        queryTestCopy("delete from private.partners where code = 'OWNERPICS';");
      } catch {
        // The copy is deleted after the run.
      }
    }
  });
});
