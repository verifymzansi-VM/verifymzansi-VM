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
// value (LAUNCH_VALUES, src/lib/launch-config.ts). Each test opens one page
// behind a switch that is on at launch, as the person who can see it, and
// checks that
//   - the page answers without a server error and is not sent elsewhere (a
//     hidden staff or member page redirects to its home);
//   - no console error and no uncaught page error happen while it loads;
//   - its key heading, and the switched-on part, render;
//   - it shows no "coming soon" or "not available" placeholder.
// Each route behind a switch is also called without a session: it must be
// served (no 404, which is how a hidden route answers) and must not fail.
// Pages and routes removed for launch must answer 404 even with every switch
// on, as the staff member who could once open them.
// Nothing here changes data, apart from the packages sales switch, which the
// launch configuration turns on in the copy (and back off at the end).
//
// The pre-launch pop-up is not checked here: browser-test builds never show it
// (PLAYWRIGHT_TEST_MODE, src/app/layout.tsx), so a browser check could not
// fail. Its launch value (off) is covered by src/lib/launch-config.test.ts.
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
  /** The address, or a function that finds it in the copy (a seeded post). */
  path: string | (() => string);
  viewer: Viewer;
  heading: RegExp;
  /** The key heading is visible text rather than a heading element (a post
   * page opens in the full-screen viewer on wide screens). */
  headingAsText?: boolean;
  /** The switched-on part: visible text or an accessible name on the page. */
  shows?: RegExp[];
  /** Steps after loading (open a tab) before `shows` is checked. */
  open?: (page: Page) => Promise<void>;
};

const PAGES: Page_[] = [
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
    feature: "SHOW_ENGAGEMENT_TOTALS",
    path: () => `/mzansi-business/${seededPostId("Fixture Mzansi Motor Workshop")}`,
    viewer: "visitor",
    heading: /Fixture Mzansi Motor Workshop/,
    headingAsText: true,
    shows: [/\bviews?\b/i],
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
    feature: "SHOW_STAFF_OPERATIONS",
    path: "/admin/operations",
    viewer: "admin",
    heading: /Operations health/i,
    shows: [/Scheduled jobs/, /Stuck emails/, /Blocked deletions/],
  },
];

/** Routes behind a switch (they answer 404 while hidden). Called without a
 * session, so nothing is changed: each must be served and must not fail. */
const ROUTES: { feature: string; method: "GET" | "POST"; path: string }[] = [
  { feature: "SHOW_ACCOUNT_DELETION", method: "POST", path: "/api/account/delete" },
  { feature: "SHOW_POST_TEMPLATES", method: "GET", path: "/api/post-templates" },
  {
    feature: "SHOW_ORGANISATION_REPORT",
    method: "GET",
    path: "/api/organisations/00000000-0000-4000-8000-000000000000/report",
  },
];

/** Staff pages removed for launch (old commercial settings, trial, programme
 * and intelligence tools): each answers 404 to an administrator. */
const REMOVED_PAGES = [
  "/admin/commercial",
  "/admin/trials",
  "/admin/programmes",
  ...["users", "verification", "revenue", "marketplace", "trends", "operations"].map(
    (name) => `/admin/intelligence/${name}`
  ),
];

/** Routes removed for launch (old trial tools and the old operations
 * "Retry" route): each answers 404. */
const REMOVED_ROUTES = [
  "/api/admin/ops/jobs/retry",
  "/api/admin/trials",
  "/api/trials",
  "/api/trial-extensions/00000000-0000-4000-8000-000000000000",
];

function seededPostId(title: string) {
  const id = readTestCopy().posts.find((post) => post.title === title)?.id;
  if (!id) throw new Error(`The copy has no seeded post "${title}"`);
  return id;
}

/** The test copy serves Realtime over an unencrypted loopback WebSocket, which
 * the site's Content Security Policy (encrypted WebSockets only) blocks on every
 * signed-in page, with switches on or off. Production's Realtime address is
 * encrypted. Only that
 * exact message is set aside; it is listed in the launch-config pull request. */
const LOCAL_REALTIME_CSP =
  /^Connecting to 'ws:\/\/127\.0\.0\.1:\d+\/realtime\/v1\/websocket\?[^']*' violates the following Content Security Policy directive/;

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
    const label = typeof entry.path === "string" ? entry.path : "seeded post page";
    test(`${label} (${entry.feature})`, async ({ context, page }) => {
      test.setTimeout(90_000);
      const path = typeof entry.path === "string" ? entry.path : entry.path();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !LOCAL_REALTIME_CSP.test(message.text()))
          consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      await signInAs(context, entry.viewer);

      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response, "the page answers").not.toBeNull();
      expect.soft(response!.status(), "no server error").toBeLessThan(500);
      await page.waitForLoadState("networkidle").catch(() => {});

      const heading = entry.headingAsText
        ? page.getByText(entry.heading).filter({ visible: true })
        : page.getByRole("heading", { name: entry.heading });
      await expect.soft(heading.first(), "key heading").toBeVisible({ timeout: 15_000 });
      // Checked after loading: a hidden page's redirect arrives in the stream.
      expect
        .soft(new URL(page.url()).pathname, "not sent elsewhere (hidden pages redirect)")
        .toBe(path);
      if (entry.open) await entry.open(page).catch(() => {});
      for (const shown of entry.shows ?? [])
        await expect
          .soft(
            page.getByText(shown).filter({ visible: true }).first(),
            `switched-on part ${shown}`
          )
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

test.describe("launch configuration: removed pages and routes", () => {
  for (const path of REMOVED_PAGES) {
    test(`${path} answers 404 to an administrator`, async ({ context, page }) => {
      await signInAs(context, "admin");
      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response, "the page answers").not.toBeNull();
      expect.soft(response!.status(), "removed (404)").toBe(404);
    });
  }

  for (const path of REMOVED_ROUTES) {
    test(`POST ${path} answers 404 to an administrator`, async ({ context }) => {
      // Signed in, so the staff route guard in front of /api/admin lets the
      // request through to routing; nothing exists there to change data.
      await signInAs(context, "admin");
      const response = await context.request.fetch(`${APP_ORIGIN}${path}`, {
        method: "POST",
        headers: { Origin: APP_ORIGIN, "Content-Type": "application/json" },
        data: {},
        maxRedirects: 0,
      });
      expect.soft(response.status(), "removed (404)").toBe(404);
    });
  }
});
