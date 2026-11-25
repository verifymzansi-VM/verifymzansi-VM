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

async function signIn(
  context: BrowserContext,
  person: "verifiedMember" | "admin" = "verifiedMember"
) {
  const session = await browserSessionCookies(readTestCopy(), person);
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

// Automatic ID checks (item 61, part 7). The copy's setting is Manual, so the
// member states are pictured with the page's two reads answered in the
// browser (synthetic data): the saved steps (phone done) and the independent
// check's route and latest check. The check's own page is a local stand-in;
// the "finish" one tells the page the member finished, as the real one does.
const CHECK = "22222222-2222-4222-8222-222222222222";
const FRAME = "https://verify.didit.me/session/owner-picture";
const DIDIT_STATES: Record<string, unknown> = {
  "02-start": { route: "automatic", reason: null, check: null },
  "02b-in-page": {
    route: "automatic",
    reason: null,
    check: { id: CHECK, status: "started", session_url: FRAME },
  },
  "03-checking": {
    route: "automatic",
    reason: null,
    check: { id: CHECK, status: "started", session_url: `${FRAME}-finish` },
  },
  "04-approved": { route: "automatic", reason: null, check: { id: CHECK, status: "approved" } },
  "05-person-will-check": {
    route: "automatic",
    reason: null,
    check: { id: CHECK, status: "with_staff", with_person: true },
  },
  "06-declined": {
    route: "automatic",
    reason: null,
    check: {
      id: CHECK,
      status: "declined",
      decline_reason: "photo_not_matched",
      can_ask_person: true,
      ask_person_until: "2026-11-30T10:00:00Z",
      asked_at: null,
    },
  },
  "08-paused": { route: "manual", reason: "paused", check: null },
};

async function answerDiditReads(page: Page, state: unknown) {
  await page.route("**/api/verification/status", (route) =>
    route.fulfill({
      json: {
        accountVerificationStatus: "incomplete",
        overallStatus: "incomplete",
        steps: [{ step_type: "phone", status: "approved" }],
      },
    })
  );
  await page.route("**/api/verification/identity-check", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: state }) : route.continue()
  );
  await page.route("**/api/foundation/profile", (route) =>
    route.fulfill({
      json: {
        legal_first_name: "Thando Sipho",
        legal_last_name: "Dlamini",
        public_name: "Thando D.",
      },
    })
  );
  await page.route("https://verify.didit.me/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<body style="margin:0;font:16px sans-serif;display:grid;place-items:center;height:100vh;background:#f5f7f6;color:#0b7a55">' +
        "<p>Independent ID check (picture stand-in)</p>" +
        (route.request().url().endsWith("-finish")
          ? '<script>parent.postMessage({type:"didit:completed"},"*")</script>'
          : "") +
        "</body>",
    })
  );
}

for (const [label, viewport] of [
  ["375", { viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
  ["1280", { viewport: { width: 1280, height: 900 } }],
] as const) {
  test.describe(`owner pictures: ID checks at ${label} px`, () => {
    test.use(viewport);

    test(`didit-02a-loading-${label}`, async ({ context, page }) => {
      await signIn(context);
      await answerDiditReads(page, DIDIT_STATES["02-start"]);
      // The route's answer is held back, so the step shows its loading line.
      await page.route("**/api/verification/identity-check", () => new Promise<void>(() => {}));
      await open(page, "/verification");
      await expect(page.getByText("Loading the ID step…")).toBeVisible();
      await page.waitForTimeout(1_500);
      await page.screenshot({
        path: test.info().outputPath(`owner-pictures-didit-02a-loading-${label}.png`),
        fullPage: true,
      });
    });

    for (const [state, answer] of Object.entries(DIDIT_STATES)) {
      test(`didit-${state}-${label}`, async ({ context, page }) => {
        await signIn(context);
        await answerDiditReads(page, answer);
        await open(page, "/verification");
        await expect(page.getByRole("heading", { name: /Step 2: ID details/ })).toBeVisible();
        if (state === "02-start") {
          await page.getByLabel(/All first names/).fill("Thando Sipho");
          await page.getByLabel(/Surname/).fill("Dlamini");
          await page.getByLabel(/I agree that VerifyMzansi asks/).check();
        }
        if (state === "03-checking") await expect(page.getByText("Checking your ID")).toBeVisible();
        await picture(page, `didit-${state}-${label}`);
        if (state === "06-declined") {
          await page.getByRole("button", { name: "Ask a person to look again" }).click();
          await page
            .getByLabel(/Anything we should know/)
            .fill("My ID book is old and the photo is faded. The names are the same as on my ID.");
          await picture(page, `didit-07-ask-a-person-${label}`);
        }
      });
    }

    for (const [state, sql] of [
      // Manual, with the two Didit settings shown disabled until part 7a.
      ["09c-staff-setting-didit-disabled", null],
      [
        "09-staff-setting-didit",
        "update private.identity_check_settings set mode = 'staff_final' where id;",
      ],
      [
        "10-staff-setting-paused",
        "update private.identity_check_settings set mode = 'staff_final', " +
          "paused_until = now() + interval '15 minutes', pause_reason = 'no_credit' where id;",
      ],
    ] as const) {
      test(`didit-${state}-${label}`, async ({ context, page }) => {
        try {
          if (sql) queryTestCopy(sql);
          await signIn(context, "admin");
          await open(page, "/admin/verification");
          await expect(page.getByRole("heading", { name: "ID checks" })).toBeVisible();
          await picture(page, `didit-${state}-${label}`);
        } finally {
          queryTestCopy(
            "update private.identity_check_settings set mode = 'manual', paused_until = null, " +
              "pause_reason = null where id;"
          );
        }
      });
    }
  });
}
