import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { MOCK_PAYMENT_ORIGIN } from "./support/mock-ozow";
import {
  browserSessionCookies,
  queryTestCopy,
  readTestCopy,
  rpc,
  serviceRpc,
  signIn,
  type Person,
} from "./support/test-copy";
import {
  registerVerifiedMember,
  reviewStaffIdentity,
  type VerifiedMember,
} from "./support/verified-member";

// Staff add lost days to a member's paid slots (launch checklist item 75), on
// the restored website in foundation mode against the private test copy: the
// "Add lost days" card on Payments & refunds checks the member's running paid
// slots, shows each new end and adds the days; the slot's end moves and the
// change is recorded. Each step is also saved as a picture for the owner
// (lost-days-<step>-<width>.png in the test's output folder, kept by CI).
//
// The member's slot is bought with the production commands the website calls
// for a checkout (the member's quote, the server's lease and attached request)
// and a synthetic successful provider event applied as the website's server
// does. As in staff-payments.spec.ts, the moderator acts: their identity is
// reviewed once per copy through the production commands, and for this spec
// only a trusted local step lets the moderator role view and refund payments
// (staff_capabilities rows, removed afterwards). Nothing contacts Ozow.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const P30 = "d6ca48e5-43be-40df-8d8c-72c98a6fda96";
const REASON = "Site down 3 to 5 December";

test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
test.describe.configure({ mode: "serial" });

let member: VerifiedMember;
let grantId = "";
const grantedCapabilities: string[] = [];

/** Only the copy's website and its gateway; anything else is aborted. */
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === APP_ORIGIN || url.origin === API_ORIGIN) return route.continue();
    outside.push(url.origin);
    return route.abort("blockedbyclient");
  });
  return outside;
}

async function signInBrowser(context: BrowserContext, person: Person) {
  const session = await browserSessionCookies(readTestCopy(), person);
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP_ORIGIN })));
}

/** The card at 1280 px and at 375 px, saved for the owner. */
async function pictures(page: Page, card: Locator, step: string) {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: test.info().outputPath(`lost-days-${step}-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.describe("staff add lost days", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const copy = readTestCopy();
    member = await registerVerifiedMember("lostdays");
    const staffId = queryTestCopy(
      "select id from auth.users where email = 'moderator@verifymzansi.test';"
    );
    expect(staffId).toMatch(UUID);
    await reviewStaffIdentity(copy, "moderator", staffId);
    for (const [capability, recent] of [
      ["payments:view", false],
      ["payments:refund", true],
    ] as const) {
      const added = queryTestCopy(
        "insert into private.staff_capabilities(role, capability, requires_recent_mfa) " +
          `values ('moderator', '${capability}', ${recent}) on conflict do nothing returning capability;`
      );
      if (added === capability) grantedCapabilities.push(capability);
    }

    // The member buys one 30-day slot.
    const session = await signIn(copy, member);
    const quote = await rpc(
      copy,
      "start_slot_checkout",
      { p_plan_id: P30, p_slots: 1, p_expected_total_cents: 6900, p_cooling_off_consent: true },
      session.token
    );
    expect(quote.status).toBe(200);
    const id = String(quote.data.payment_id);
    const lease = await serviceRpc("claim_checkout_request", {
      p_payment_id: id,
      p_owner_id: member.id,
    });
    expect(lease.status).toBe(200);
    expect(
      await serviceRpc("complete_checkout_request", {
        p_payment_id: id,
        p_owner_id: member.id,
        p_claim_token: lease.data.claim_token,
        p_request_id: `mock-${id}`,
        p_checkout_url: `${MOCK_PAYMENT_ORIGIN}/checkout?paymentId=${id}`,
      })
    ).toMatchObject({ status: 200, data: true });
    const merchantReference = queryTestCopy(
      `select merchant_reference from private.payments where id = '${id}';`
    );
    const settled = await serviceRpc("apply_provider_event", {
      p_event: {
        payload_sha256: createHash("sha256").update(`lost-days-${id}`).digest("hex"),
        merchant_reference: merchantReference,
        provider_request_id: `mock-${id}`,
        provider_transaction_id: `tx-${id}`,
        status: "complete",
        amount_cents: 6900,
        currency: "ZAR",
      },
    });
    expect(settled).toMatchObject({ status: 200, data: { outcome: "completed" } });
    grantId = queryTestCopy(
      `select id from private.entitlements where payment_id = '${id}' and status = 'active';`
    );
    expect(grantId).toMatch(UUID);
  });

  test.afterAll(() => {
    for (const capability of grantedCapabilities.splice(0))
      queryTestCopy(
        "delete from private.staff_capabilities " +
          `where role = 'moderator' and capability = '${capability}';`
      );
  });

  test("staff check the member's slots, see the new end and add the days", async ({
    context,
    page,
  }) => {
    const endBefore = queryTestCopy(
      `select extract(epoch from ends_at) from private.entitlements where id = '${grantId}';`
    );
    const outside = await guard(context);
    await signInBrowser(context, "moderator");
    await page.goto("/admin/payments");
    const heading = page.getByRole("heading", { name: "Add lost days" });
    await expect(heading).toBeVisible();
    const card = page.locator("section").filter({ has: heading });
    await pictures(page, card, "1-closed");

    await card.getByRole("button", { name: "Add lost days" }).click();
    await card.getByLabel("Member's account email").fill(member.email);
    await card.getByRole("button", { name: "Check slots" }).click();
    const form = card.getByRole("form", { name: "Add lost days" });
    await expect(form.getByText("Individual slot", { exact: true })).toBeVisible();
    await form.getByLabel("Days").fill("7");
    await form.getByLabel("Reason (audited)").fill(REASON);
    await expect(form.getByText(/^Ends .+ → .+$/)).toBeVisible();
    await pictures(page, card, "2-checked");

    await form.getByRole("button", { name: "Add 7 days" }).click();
    await expect(card.getByRole("status")).toHaveText(`Added 7 days to ${member.email}.`);
    await expect(card.getByRole("list", { name: "Slots with days added" })).toBeVisible();
    await pictures(page, card, "3-added");

    const endAfter = queryTestCopy(
      `select extract(epoch from ends_at) from private.entitlements where id = '${grantId}';`
    );
    expect(Number(endAfter) - Number(endBefore)).toBe(7 * 86400);
    expect(
      queryTestCopy(
        `select count(*) || '|' || min(days) || '|' || min(reason) from private.lost_day_additions where entitlement_id = '${grantId}';`
      )
    ).toBe(`1|7|${REASON}`);
    expect(outside).toEqual([]);
  });
});
