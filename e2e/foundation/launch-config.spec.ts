import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import {
  browserSessionCookies,
  queryTestCopy,
  readTestCopy,
  type PersonKey,
} from "./support/test-copy";

// Launch-configuration smoke (playwright.launch-config.config.ts only): the
// test copy built with every switch that hides a feature set to its launch
// value (src/lib/launch-config.ts). Each test opens one page behind a switch
// as the person who can see it and checks that
//   - the page answers without a server error and is not sent elsewhere (a
//     hidden staff or member page redirects to its home);
//   - no console error and no uncaught page error happen while it loads;
//   - its key heading, and the switched-on part, render;
//   - it shows no "coming soon" or "not available" placeholder.
// Each route behind a switch is also called without a session: it must be
// served (no 404, which is how a hidden route answers) and must not fail.
// Nothing here changes data, apart from the packages sales switch, which the
// launch configuration turns on in the copy (and back off at the end).
//
// This lane is advisory: it reports what launch day would break. A failure
// here is a finding for the launch checklist, not a reason to weaken a check.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;

/** Placeholder wording a switched-on page must not show. */
const PLACEHOLDER =
  /coming soon|launching soon|available soon|open soon|not available( yet)?|isn['’]t available|unavailable|under construction/i;

type Viewer = "visitor" | PersonKey;

type Page_ = {
  /** Which switch the page sits behind (src/lib/hidden-features.ts, ...). */
  feature: string;
  path: string;
  viewer: Viewer;
  heading: RegExp;
  /** The switched-on part: visible text or an accessible name on the page. */
  shows?: RegExp[];
  /** Steps after loading (open a tab) before `shows` is checked. */
  open?: (page: Page) => Promise<void>;
  /** Cookies set before loading (the visitor's chosen province). */
  cookies?: Record<string, string>;
};

const PAGES: Page_[] = [
  {
    feature: "PRELAUNCH_BANNER_ENABLED (off at launch), SHOW_SPONSOR_OFFER",
    path: "/",
    viewer: "visitor",
    heading: /.+/,
    shows: [/Become a Business Sponsor/],
  },
  {
    feature: "SHOW_PAID_ADDONS, SHOW_SPONSOR_OFFER, PACKAGES_ON_SALE",
    path: "/advertise",
    viewer: "visitor",
    heading: /.+/,
    shows: [/Get more eyes on a post/i, /Multi-listing/i, /Business Sponsor/i],
  },
  {
    feature: "SHOW_SPONSOR_OFFER",
    path: "/sponsors",
    viewer: "visitor",
    heading: /Business Sponsors/i,
    shows: [/Become a Business Sponsor/],
  },
  {
    feature: "SHOW_PAID_ADDONS, SHOW_OWNER_METRICS",
    path: "/help/showroom",
    viewer: "visitor",
    heading: /How the showroom works/i,
    shows: [/Boost/, /Featured/],
  },
  {
    feature: "PACKAGES_ON_SALE",
    path: "/pricing",
    viewer: "visitor",
    heading: /.+/,
    shows: [/Multi-listing/i],
  },
  {
    feature: "PACKAGES_ON_SALE (and the copy's packages sales switch), SHOW_PACKAGE_TEAMS",
    path: "/pricing/multi-listing",
    viewer: "visitor",
    heading: /Keep your whole stock live/i,
    shows: [/You \+ 1 person/],
  },
  {
    feature: "SHOW_SHOWROOM_PROVINCE_CHIP",
    path: "/mzansi-market",
    viewer: "visitor",
    heading: /^mzansi market$/i,
    cookies: { vmz_province: "Gauteng" },
    shows: [/Showing\s+Gauteng\s+first/i],
  },
  {
    feature: "SHOW_OWNER_METRICS",
    path: "/dashboard/metrics",
    viewer: "verifiedMember",
    heading: /^Performance$/i,
  },
  {
    feature: "SHOW_ACCOUNT_DELETION",
    path: "/dashboard/profile",
    viewer: "verifiedMember",
    heading: /.+/,
    open: async (page) => page.getByRole("tab", { name: "Account" }).click(),
    shows: [/Delete account/],
  },
  {
    feature: "SHOW_DATA_USE_CHOICES",
    path: "/dashboard/communication",
    viewer: "verifiedMember",
    heading: /.+/,
    open: async (page) => page.getByRole("tab", { name: "Preferences" }).click(),
    shows: [/Analytics/, /Third-party sharing/],
  },
  {
    feature: "SHOW_STAFF_COMMERCIAL_SETTINGS",
    path: "/admin/commercial",
    viewer: "admin",
    heading: /Commercial settings/i,
  },
  {
    feature: "SHOW_STAFF_TRIALS",
    path: "/admin/trials",
    viewer: "admin",
    heading: /Free Posts & Trials/i,
  },
  {
    feature: "SHOW_STAFF_PROGRAMMES",
    path: "/admin/programmes",
    viewer: "admin",
    heading: /Programmes & Contracts/i,
  },
  {
    feature: "SHOW_STAFF_OPERATIONS",
    path: "/admin/operations",
    viewer: "admin",
    heading: /Operations health/i,
  },
  ...(
    [
      ["users", /Users & growth/i],
      ["marketplace", /Marketplace health/i],
      ["operations", /Operations summary/i],
      ["revenue", /Revenue & costs/i],
      ["trends", /^Trends$/i],
      ["verification", /Verification metrics/i],
    ] as const
  ).map(([name, heading]): Page_ => ({
    feature: "SHOW_STAFF_INTELLIGENCE",
    path: `/admin/intelligence/${name}`,
    viewer: "admin",
    heading,
  })),
];

/** Routes behind a switch (they answer 404 while hidden). Called without a
 * session, so nothing is changed: each must be served and must not fail. */
const ROUTES: { feature: string; method: "GET" | "POST"; path: string }[] = [
  { feature: "SHOW_ACCOUNT_DELETION", method: "POST", path: "/api/account/delete" },
  { feature: "SHOW_STAFF_TRIALS", method: "POST", path: "/api/admin/trials" },
  { feature: "SHOW_STAFF_OPERATIONS", method: "POST", path: "/api/admin/ops/jobs/retry" },
  { feature: "SHOW_TRIAL_PLAN_CHANGES", method: "POST", path: "/api/trials" },
  {
    feature: "SHOW_TRIAL_EXTENSION_OFFERS",
    method: "POST",
    path: "/api/trial-extensions/00000000-0000-4000-8000-000000000000",
  },
  {
    feature: "SHOW_ORGANISATION_REPORT",
    method: "GET",
    path: "/api/organisations/00000000-0000-4000-8000-000000000000/report",
  },
];

async function signInAs(context: BrowserContext, viewer: Viewer) {
  if (viewer === "visitor") return;
  const session = await browserSessionCookies(readTestCopy(), viewer);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
}

let packagesWereOnSale: string | null = null;

test.beforeAll(() => {
  // Only meaningful in the launch-configuration build.
  expect(
    process.env.VERIFYMZANSI_LAUNCH_CONFIG,
    "run with playwright.launch-config.config.ts"
  ).toBe("1");
  // The multi-listing page also needs the database's packages sales switch
  // (private.slot_package_sales), which only the owner turns on in production.
  // Trusted local step (copy only).
  packagesWereOnSale = queryTestCopy(
    "select coalesce((select on_sale::text from private.slot_package_sales where singleton), 'absent');"
  );
  queryTestCopy(
    "insert into private.slot_package_sales(singleton, on_sale, reason) " +
      "values (true, true, 'launch-config browser test') " +
      "on conflict (singleton) do update set on_sale = true, changed_at = statement_timestamp(), " +
      "reason = 'launch-config browser test';"
  );
});

test.afterAll(() => {
  if (packagesWereOnSale === "absent")
    queryTestCopy("delete from private.slot_package_sales where singleton;");
  else if (packagesWereOnSale === "false")
    queryTestCopy(
      "update private.slot_package_sales set on_sale = false, changed_at = statement_timestamp(), " +
        "reason = 'launch-config browser test ended' where singleton;"
    );
});

test.describe("launch configuration: pages behind a switch", () => {
  for (const entry of PAGES) {
    test(`${entry.path} (${entry.feature})`, async ({ context, page }) => {
      test.setTimeout(90_000);
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      await signInAs(context, entry.viewer);
      if (entry.cookies)
        await context.addCookies(
          Object.entries(entry.cookies).map(([name, value]) => ({ name, value, url: APP_ORIGIN }))
        );

      const response = await page.goto(entry.path, { waitUntil: "domcontentloaded" });
      expect(response, "the page answers").not.toBeNull();
      expect.soft(response!.status(), "no server error").toBeLessThan(500);
      expect
        .soft(new URL(page.url()).pathname, "not sent elsewhere (hidden pages redirect)")
        .toBe(entry.path);
      await page.waitForLoadState("networkidle").catch(() => {});

      await expect
        .soft(page.getByRole("heading", { name: entry.heading }).first(), "key heading")
        .toBeVisible({ timeout: 15_000 });
      // The pre-launch pop-up is off at launch.
      await expect
        .soft(page.getByRole("dialog", { name: /launching soon/i }), "no pre-launch pop-up")
        .toHaveCount(0);
      if (entry.open) await entry.open(page).catch(() => {});
      for (const shown of entry.shows ?? [])
        await expect
          .soft(page.getByText(shown).first(), `switched-on part ${shown}`)
          .toBeVisible({ timeout: 15_000 });

      const text = await page
        .locator("main")
        .first()
        .innerText()
        .catch(() => "");
      expect.soft(text.match(PLACEHOLDER)?.[0] ?? null, "no placeholder wording").toBeNull();
      expect.soft(consoleErrors, "no console errors").toEqual([]);
      expect.soft(pageErrors, "no uncaught page errors").toEqual([]);
    });
  }
});

test.describe("launch configuration: routes behind a switch", () => {
  for (const route of ROUTES) {
    test(`${route.method} ${route.path} is served (${route.feature})`, async ({ playwright }) => {
      // A fresh request context: no session, so the route cannot act.
      const request = await playwright.request.newContext({ baseURL: APP_ORIGIN });
      try {
        const response = await request.fetch(route.path, {
          method: route.method,
          headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
          ...(route.method === "POST" ? { data: {} } : {}),
          maxRedirects: 0,
        });
        expect.soft(response.status(), "served (a hidden route answers 404)").not.toBe(404);
        expect.soft(response.status(), "no server error").toBeLessThan(500);
      } finally {
        await request.dispose();
      }
    });
  }
});
