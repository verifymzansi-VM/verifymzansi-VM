import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { E2E_FIXTURE } from "../../scripts/lib/foundation-e2e-target.mjs";
import {
  browserSessionCookies,
  queryTestCopy,
  readTestCopy,
  type Person,
} from "./support/test-copy";
import {
  registerVerifiedMember,
  reviewStaffIdentity,
  type VerifiedMember,
} from "./support/verified-member";

// Staff record a cleared bank transfer (EFT) as a payment (roadmap P2b), on
// the restored website in foundation mode against the private test copy:
// - the staff payments page has a "Record a bank transfer" form; recorded,
//   the customer's slots start, with an invoice and the receipt event;
// - the payment's row shows the bank reference, and its refund form asks for
//   the reference of the transfer back;
// - the same bank reference cannot be recorded for another order.
//
// As in staff-payments.spec.ts, the moderator acts: the moderator's identity
// is reviewed once per copy through the production commands, and for this
// spec only a trusted local step lets the moderator role view and refund
// payments (two staff_capabilities rows, removed afterwards). Nothing contacts
// a bank or Ozow.

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const API_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.apiPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REASON = "EFT cleared; the customer's written waiver is on file";

test.use({ serviceWorkers: "block" });
test.describe.configure({ mode: "serial" });

let member: VerifiedMember;
const grantedCapabilities: string[] = [];
let reference = "";

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

async function fillTransfer(page: Page, amount: string, slots = "2") {
  const form = page.getByRole("form", { name: "Record a bank transfer" });
  await form.getByLabel("Customer's account email").fill(member.email);
  await form.getByLabel("Slot term").selectOption("30");
  await form.getByLabel("Number of slots").fill(slots);
  await form.getByLabel("Amount received (R)").fill(amount);
  await form.getByLabel("Bank reference").fill(reference);
  await form.getByRole("checkbox").check();
  await form.getByLabel("Reason (audited)").fill(REASON);
  return form;
}

test.describe("staff record a cleared bank transfer", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    const copy = readTestCopy();
    member = await registerVerifiedMember("banktransfer");
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
    reference = `E2E EFT ${Date.now()}`;
  });

  test.afterAll(() => {
    for (const capability of grantedCapabilities.splice(0))
      queryTestCopy(
        "delete from private.staff_capabilities " +
          `where role = 'moderator' and capability = '${capability}';`
      );
  });

  test("staff record it; the slots start and the row shows the bank reference", async ({
    context,
    page,
  }, testInfo) => {
    const shot = (name: string) =>
      page.screenshot({ path: `output/p2b/${testInfo.project.name}-${name}.png`, fullPage: true });
    const outside = await guard(context);
    await signInBrowser(context, "moderator");
    await page.goto("/admin/payments");
    await expect(page.getByRole("heading", { name: "Record a bank transfer" })).toBeVisible();
    await shot("1-payments-page");
    await page.getByRole("button", { name: "Record a bank transfer" }).click();
    const form = await fillTransfer(page, "100");
    await expect(form.getByText("Order total: R138")).toBeVisible();
    await expect(form.getByText(/Not the order total/)).toBeVisible();
    await shot("2-form-amount-differs");
    await form.getByLabel("Amount received (R)").fill("138.00");
    await expect(form.getByText(/Not the order total/)).toHaveCount(0);
    await shot("3-form-filled");
    page.on("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Record bank transfer" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Bank transfer recorded" })
    ).toBeVisible();

    // An ordinary payment with the method 'invoice': delivered, two slots,
    // its invoice and the receipt event.
    const [id, state] = queryTestCopy(
      `select p.id || '|' || p.provider || ',' || p.status || ',' || p.fulfillment_status || ',' || p.amount_cents
         || ',' || (select count(*) from private.entitlements e where e.payment_id = p.id and e.status = 'active')
         || ',' || (select count(*) from private.invoices i where i.payment_id = p.id)
         || ',' || (select count(*) from private.outbox_events o where o.subject_id = p.id and o.kind = 'payment_completed')
       from private.payments p join private.invoice_payments t on t.payment_id = p.id
       where t.bank_reference = '${reference}';`
    ).split("|");
    expect(id).toMatch(UUID);
    expect(state).toBe("invoice,complete,fulfilled,13800,2,1,1");
    expect(
      queryTestCopy(
        `select count(*) from private.frontend_staff_audit_events where target_id = '${id}' and action = 'payment:invoice_recorded';`
      )
    ).toBe("1");

    const row = page.getByRole("listitem").filter({ hasText: `Bank transfer ${reference}` });
    await expect(row).toBeVisible();
    await shot("4-recorded-row");
    await row.getByRole("button", { name: "Record refund" }).click();
    const refund = page.getByRole("form", { name: "Refund of the whole order" });
    await expect(refund.getByLabel("Bank reference of the refund transfer")).toBeVisible();
    await shot("5-refund-form");
    expect(outside).toEqual([]);
  });

  test("the same bank reference cannot be recorded for another order", async ({
    context,
    page,
  }) => {
    const outside = await guard(context);
    await signInBrowser(context, "moderator");
    await page.goto("/admin/payments");
    await page.getByRole("button", { name: "Record a bank transfer" }).click();
    const form = await fillTransfer(page, "69", "1");
    page.on("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: "Record bank transfer" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "That bank reference was already recorded" })
    ).toHaveText(
      "That bank reference was already recorded. Check the payments list before recording it."
    );
    expect(
      queryTestCopy(
        `select count(*) from private.payments where owner_id = '${member.id}' and provider = 'invoice';`
      )
    ).toBe("1");
    expect(outside).toEqual([]);
  });
});
