import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_FIXTURE, LOCAL_OZOW_SITE_CODE } from "../../scripts/lib/foundation-e2e-target.mjs";
import { MOCK_PAYMENT_ORIGIN, MockOzow } from "./support/mock-ozow";
import {
  browserSessionCookies,
  queryTestCopy,
  readTestCopy,
  rpc,
  serviceRpc,
  signIn,
  type Person,
  type TestCopy,
} from "./support/test-copy";
import {
  registerVerifiedMember,
  reviewStaffIdentity,
  type VerifiedMember,
} from "./support/verified-member";

// Staff find and fix paid but not delivered (roadmap M3.4), on the restored
// website in foundation mode against the private test copy:
// - a payment the bank completed after its checkout was cancelled (paid, not
//   delivered) appears on the staff payments page under "Needs attention";
// - staff activate what was paid for; an audit row exists and the member
//   sees the slot;
// - recording a refund without Ozow's reference is refused (the form, the
//   website route and the database command).
//
// The payment is arranged with the production commands the website calls for
// a mock checkout (the member's quote, the server's lease and the attached
// mock request) and cancelled with the command the website's Cancel calls;
// the provider's successful notice then goes to the website's real
// notification route, signed by the copy's mock (support/mock-ozow.ts). Ozow
// is never contacted.
//
// Staff money actions need a current accepted ID review of the staff
// member's own (internal.assert_staff_payment_actor). The copy's staff have
// none, and the admin's own review would change what the staff review spec
// expects of the admin's identity case, so the moderator acts here: once per
// copy the moderator's identity is reviewed by the admin through the
// production commands (as for any member), and for this spec only a trusted
// local step lets the moderator role view and refund payments (two
// staff_capabilities rows, removed afterwards).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const P30 = "d6ca48e5-43be-40df-8d8c-72c98a6fda96";
const ACTIVATION_REASON = "Paid at the bank after the checkout was cancelled";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

const ozow = new MockOzow();
let copy: TestCopy;
let member: VerifiedMember;
let staffId = "";
const grantedCapabilities: string[] = [];
let payment = { id: "", merchantReference: "", amountCents: 0 };

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

function notice(status: "Successful") {
  return ozow.notify({
    TransactionId: randomUUID(),
    TransactionReference: payment.merchantReference,
    SiteCode: LOCAL_OZOW_SITE_CODE,
    IsTest: "True",
    Status: status,
    Amount: (payment.amountCents / 100).toFixed(2),
    CurrencyCode: "ZAR",
    paymentRequestId: `mock-${payment.id}`,
  });
}

function paymentState() {
  return queryTestCopy(
    `select status || '|' || fulfillment_status from private.payments where id = '${payment.id}';`
  );
}

/** The payment's row on the staff payments page. */
function paymentRow(page: Page) {
  return page.getByRole("listitem").filter({ hasText: `Ref ${payment.merchantReference}` });
}

/** POSTs to the website's staff route from the signed-in page (with its CSRF token). */
async function commercial(page: Page, body: unknown) {
  return page.evaluate(async (payload) => {
    const token = /(?:^|;\s*)vm_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? "";
    const response = await fetch("/api/admin/commercial", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": token },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, body);
}

test.describe("staff fix paid but not delivered", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    copy = readTestCopy();
    member = await registerVerifiedMember("paidfix");
    staffId = queryTestCopy(
      "select id from auth.users where email = 'moderator@verifymzansi.test';"
    );
    expect(staffId).toMatch(UUID);
    await reviewStaffIdentity(copy, "moderator", staffId);
    // Trusted local step: the moderator role may view and refund payments for
    // this spec (removed in afterAll).
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

    // The member's quote and the server's mock request, as for a checkout.
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
    const [merchantReference, amountCents] = queryTestCopy(
      `select merchant_reference, amount_cents from private.payments where id = '${id}';`
    ).split("|");
    payment = { id, merchantReference, amountCents: Number(amountCents) };
  });

  test.afterAll(() => {
    for (const capability of grantedCapabilities.splice(0))
      queryTestCopy(
        "delete from private.staff_capabilities " +
          `where role = 'moderator' and capability = '${capability}';`
      );
  });

  test("a paid but not activated payment appears under Needs attention", async ({
    context,
    page,
  }) => {
    // The checkout is cancelled (the command the website's Cancel calls once
    // Ozow closed the request); the bank later reports it paid.
    expect(
      await serviceRpc("finish_unpaid_checkout", {
        p_payment_id: payment.id,
        p_status: "cancelled",
      })
    ).toMatchObject({ status: 200, data: true });
    expect(paymentState()).toBe("cancelled|unfulfilled");
    expect(await notice("Successful")).toMatchObject({ status: 200 });
    expect(paymentState()).toBe("complete|needs_reconciliation");

    const outside = await guard(context);
    await signInBrowser(context, "moderator");
    await page.goto("/admin/payments");
    await expect(
      page.getByRole("link", { name: /paid but not delivered: needs attention/ })
    ).toBeVisible();
    await page.getByRole("link", { name: /paid but not delivered: needs attention/ }).click();
    await page.waitForURL((url) => url.searchParams.get("status") === "needs_attention");
    const row = paymentRow(page);
    await expect(row).toBeVisible();
    await expect(row.getByText("not delivered", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Activate what was paid for" })).toBeVisible();
    expect(outside).toEqual([]);
  });

  test("staff activate it, with an audit row, and the member sees the slot", async ({
    browser,
    context,
    page,
  }) => {
    const outside = await guard(context);
    await signInBrowser(context, "moderator");
    await page.goto("/admin/payments?status=needs_attention");
    page.on("dialog", (dialog) =>
      dialog.type() === "prompt" ? dialog.accept(ACTIVATION_REASON) : dialog.accept()
    );
    await paymentRow(page).getByRole("button", { name: "Activate what was paid for" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Activated" })).toBeVisible();
    expect(paymentState()).toBe("complete|fulfilled");
    // The audit row: in the table and in the staff audit trail.
    expect(
      queryTestCopy(
        `select actor_id || '|' || reason || '|' || entitlements from private.payment_activations where payment_id = '${payment.id}';`
      )
    ).toBe(`${staffId}|${ACTIVATION_REASON}|1`);
    expect(
      queryTestCopy(
        `select count(*) from private.frontend_staff_audit_events where target_id = '${payment.id}' and action = 'payment:activated';`
      )
    ).toBe("1");
    expect(outside).toEqual([]);

    // The member sees the slot.
    const memberContext = await browser.newContext({ serviceWorkers: "block" });
    try {
      const memberOutside = await guard(memberContext);
      await signInBrowser(memberContext, member);
      const memberPage = await memberContext.newPage();
      await memberPage.goto("/dashboard/slots");
      await expect(
        memberPage
          .getByRole("list", { name: "Your slots" })
          .getByText("Individual slot", { exact: true })
      ).toBeVisible();
      expect(memberOutside).toEqual([]);
    } finally {
      await memberContext.close();
    }
  });

  test("recording a refund without an Ozow reference is refused", async ({ context, page }) => {
    const outside = await guard(context);
    await signInBrowser(context, "moderator");
    await page.goto("/admin/payments");
    const row = paymentRow(page);
    await row.getByRole("button", { name: "Record refund" }).click();
    const form = page.getByRole("form", { name: "Refund of this payment" });
    await form.locator("select[name=reasonCode]").selectOption("billing_error");
    await form.locator("input[name=reason]").fill("Refund without a reference");
    const sent: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/admin/commercial") sent.push(request.method());
    });
    await form.getByRole("button", { name: "Record refund" }).click();
    // The browser keeps the form: the reference is required.
    expect(
      await form
        .getByLabel("Ozow refund reference")
        .evaluate((input) => (input as HTMLInputElement).validity.valueMissing)
    ).toBe(true);
    expect(sent).toEqual([]);

    // The website route refuses it, and so does the database command.
    expect(
      await commercial(page, {
        action: "payment.reverse",
        paymentId: payment.id,
        kind: "refunded",
        reasonCode: "billing_error",
        ozowReference: "",
        reason: "Refund without a reference",
      })
    ).toEqual({
      status: 422,
      body: expect.objectContaining({ error: "Enter Ozow's refund reference." }),
    });
    const staff = await signIn(copy, "moderator");
    const refused = await rpc(
      copy,
      "record_staff_payment_refund",
      {
        p_payment_id: payment.id,
        p_kind: "refunded",
        p_reason_code: "billing_error",
        p_reason: "Refund without a reference",
        p_ozow_reference: null,
      },
      staff.token
    );
    expect(refused.status).toBe(400);
    expect(refused.data).toMatchObject({ code: "22023", details: "ozow_reference_required" });
    expect(paymentState()).toBe("complete|fulfilled");
    expect(
      queryTestCopy(
        `select count(*) from private.payment_refund_requests where payment_id = '${payment.id}';`
      )
    ).toBe("0");
    expect(outside).toEqual([]);
  });
});
