import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  E2E_FIXTURE,
  LOCAL_INTERNAL_JOBS_SECRET,
  LOCAL_OPS_JOBS_SECRET,
  LOCAL_OZOW_SITE_CODE,
  LOCAL_PAYMENT_ALERT_EMAIL,
} from "../../scripts/lib/foundation-e2e-target.mjs";
import { MOCK_PAYMENT_ORIGIN, MockOzow } from "./support/mock-ozow";
import {
  latestMailTo,
  queryTestCopy,
  readOutboundAttempts,
  readServerLogEntries,
  readTestCopy,
  rpc,
  serverLogMentions,
  serviceRpc,
  signIn,
  type TestCopy,
} from "./support/test-copy";
import { registerVerifiedMember, type VerifiedMember } from "./support/verified-member";

// Payment problems are logged and staff are told (roadmap M3.3), on the
// restored website in foundation mode against the private test copy:
// - a signed notice with the wrong amount, and a second successful payment on
//   a completed payment, are each refused, logged with the payment number and
//   reason code, and emailed to the staff address within two minutes;
// - the 10-minute status check that finds two successful bank transactions on
//   one payment request reports that payment and its reason in its reply and
//   the log, settles nothing, and staff are emailed.
// The staff address is the copy's .test address (PAYMENT_ALERT_EMAILS), so the
// email lands in the local mail catcher through the copy's relay. The provider
// is the copy's mock (support/mock-ozow.ts); Ozow is never contacted, and the
// website's server tries nothing off this machine.
//
// Payments are arranged with the production commands the website itself calls
// for a mock checkout (the member's quote, the server's lease and the attached
// mock request), so no browser is needed. A payment left pending with two bank
// transactions would fail every later status-check run in this copy, so it is
// moved out of the status check's 14-day window afterwards (trusted local step).

const APP_ORIGIN = `http://127.0.0.1:${E2E_FIXTURE.appPort}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TWO_MINUTES = 120_000;
const ALERT_SUBJECT = /^VerifyMzansi payment alert: /;

test.describe.configure({ mode: "serial" });

type Plan = { id: string; code: string; price_cents: string };
type Payment = { id: string; merchantReference: string; amountCents: number };

const ozow = new MockOzow();
let copy: TestCopy;
let member: VerifiedMember;
let plans: Plan[];
const leftPending: string[] = [];

/** A pending plan payment with an attached mock Ozow request. */
async function pendingPayment(plan: Plan): Promise<Payment> {
  const session = await signIn(copy, member);
  const quote = await rpc(
    copy,
    "start_checkout",
    { p_product_id: plan.id, p_target_post: null },
    session.token
  );
  expect(quote.status).toBe(200);
  const id = String(quote.data.payment_id);
  expect(id).toMatch(UUID);
  const lease = await serviceRpc("claim_checkout_request", {
    p_payment_id: id,
    p_owner_id: member.id,
  });
  expect(lease.status).toBe(200);
  const attached = await serviceRpc("complete_checkout_request", {
    p_payment_id: id,
    p_owner_id: member.id,
    p_claim_token: lease.data.claim_token,
    p_request_id: `mock-${id}`,
    p_checkout_url: `${MOCK_PAYMENT_ORIGIN}/checkout?paymentId=${id}`,
  });
  expect(attached).toMatchObject({ status: 200, data: true });
  const [merchantReference, amountCents] = queryTestCopy(
    `select merchant_reference, amount_cents from private.payments where id = '${id}';`
  ).split("|");
  return { id, merchantReference, amountCents: Number(amountCents) };
}

/** A signed transaction notice for the payment, as the provider sends one. */
function notice(payment: Payment, change: Record<string, unknown> = {}) {
  return ozow.notify({
    TransactionId: randomUUID(),
    TransactionReference: payment.merchantReference,
    SiteCode: LOCAL_OZOW_SITE_CODE,
    IsTest: "True",
    Status: "Successful",
    Amount: (payment.amountCents / 100).toFixed(2),
    CurrencyCode: "ZAR",
    paymentRequestId: `mock-${payment.id}`,
    ...change,
  });
}

/** The ops-jobs Worker's one-minute run of the website's email job. */
async function runEmailJob(request: APIRequestContext) {
  const response = await request.post("/api/webhooks/ops-jobs", {
    headers: { Authorization: `Bearer ${LOCAL_OPS_JOBS_SECRET}` },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
}

function problem(paymentId: string, reason: string) {
  const row = queryTestCopy(
    "select source, needs_alert, alerted_at is not null, occurrences from private.payment_problems " +
      `where payment_id = '${paymentId}' and reason = '${reason}';`
  );
  if (!row) return null;
  const [source, alert, emailed, occurrences] = row.split("|");
  return {
    source,
    alert: alert === "t",
    emailed: emailed === "t",
    occurrences: Number(occurrences),
  };
}

/** Structured log lines with this message for this payment. */
function logged(message: string, paymentId: string) {
  return readServerLogEntries(message)
    .map((entry) => entry.meta ?? {})
    .filter((meta) => meta.paymentId === paymentId);
}

/** The email job runs once; staff receive the alert naming the payment. */
async function expectStaffAlert(
  request: APIRequestContext,
  payment: Payment,
  since: number,
  words: string
) {
  const before = Date.now();
  await runEmailJob(request);
  const mail = await latestMailTo(LOCAL_PAYMENT_ALERT_EMAIL, {
    after: before - 1000,
    subject: ALERT_SUBJECT,
    timeoutMs: 30_000,
  });
  expect(Date.now() - since).toBeLessThan(TWO_MINUTES);
  expect(mail.subject).toContain(words);
  expect(mail.text).toContain(`Payment number: ${payment.id}`);
  expect(mail.text).toContain(`Ozow reference: ${payment.merchantReference}`);
  // Payment numbers only: no member name or address.
  for (const value of [member.email, member.firstName, member.lastName])
    expect(mail.text).not.toContain(value);
  return mail;
}

test.describe("payment problems reach staff", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    copy = readTestCopy();
    const catalogue = await rpc(copy, "billing_catalogue", {});
    expect(catalogue.status).toBe(200);
    const byCode = (code: string) => {
      const plan = (catalogue.data.plans as Plan[]).find((entry) => entry.code === code);
      if (!plan) throw new Error(`The catalogue has no plan ${code}`);
      return plan;
    };
    plans = ["market_30d", "business_30d", "tourism_30d"].map(byCode);
    member = await registerVerifiedMember("alerts");
    await ozow.start();
    // Earlier problems in this copy are already emailed or not ours to wait on.
    queryTestCopy(
      "update private.payment_problems set alerted_at = now(), alert_claimed_until = null " +
        "where needs_alert and alerted_at is null;"
    );
  });

  test.afterAll(async () => {
    try {
      // Out of the status check's 14-day window, so later runs in this copy
      // are not failed by the payments arranged here.
      for (const id of leftPending)
        queryTestCopy(
          `update private.payments set created_at = now() - interval '15 days' where id = '${id}' and status = 'pending';`
        );
    } finally {
      await ozow.stop();
    }
  });

  test("a notice with the wrong amount is logged and emailed to staff within two minutes", async ({
    request,
  }) => {
    const mark = readOutboundAttempts().length;
    const payment = await pendingPayment(plans[0]);
    leftPending.push(payment.id);
    const since = Date.now();
    const reply = await notice(payment, { Amount: ((payment.amountCents + 100) / 100).toFixed(2) });
    expect(reply).toEqual({ status: 200, body: { success: true, rejected: "amount_mismatch" } });
    expect(
      queryTestCopy(
        `select status, fulfillment_status from private.payments where id = '${payment.id}';`
      )
    ).toBe("pending|unfulfilled");
    await expect
      .poll(() => logged("Payment problem", payment.id))
      .toEqual([
        {
          paymentId: payment.id,
          reason: "amount_mismatch",
          source: "notice",
          anomaly: "wrong_amount",
        },
      ]);
    expect(problem(payment.id, "amount_mismatch")).toEqual({
      source: "notice",
      alert: true,
      emailed: false,
      occurrences: 1,
    });

    await expectStaffAlert(request, payment, since, "(wrong amount)");
    expect(problem(payment.id, "amount_mismatch")?.emailed).toBe(true);
    // Sent once: the next run sends nothing new about it.
    const after = Date.now();
    await runEmailJob(request);
    await expect(
      latestMailTo(LOCAL_PAYMENT_ALERT_EMAIL, { after, subject: ALERT_SUBJECT, timeoutMs: 3000 })
    ).rejects.toThrow();
    expect(readOutboundAttempts().slice(mark)).toEqual([]);
  });

  test("a second successful payment on a completed payment is logged and emailed to staff", async ({
    request,
  }) => {
    const mark = readOutboundAttempts().length;
    const payment = await pendingPayment(plans[1]);
    // The member pays at the test bank; its signed notice completes the payment.
    const returnUrl = `${APP_ORIGIN}/billing/success?payment=${payment.id}`;
    await ozow.handle(
      new URL(
        `/pay?paymentId=${payment.id}&returnUrl=${encodeURIComponent(returnUrl)}&outcome=paid`,
        MOCK_PAYMENT_ORIGIN
      )
    );
    expect(ozow.notifications.at(-1)).toMatchObject({ paymentId: payment.id, status: 200 });
    expect(
      queryTestCopy(
        `select status, fulfillment_status from private.payments where id = '${payment.id}';`
      )
    ).toBe("complete|fulfilled");

    // The bank reports a second successful transaction on the same request.
    const since = Date.now();
    const reply = await notice(payment);
    expect(reply).toEqual({
      status: 200,
      body: { success: true, rejected: "transaction_id_mismatch" },
    });
    await expect
      .poll(() => logged("Payment problem", payment.id))
      .toEqual([
        {
          paymentId: payment.id,
          reason: "transaction_id_mismatch",
          source: "notice",
          anomaly: "paid_twice",
        },
      ]);
    const mail = await expectStaffAlert(request, payment, since, "(paid twice)");
    expect(mail.text).toContain("A second transaction on a payment that is already complete");
    // The first payment stands; nothing was reversed.
    expect(
      queryTestCopy(
        `select status, fulfillment_status from private.payments where id = '${payment.id}';`
      )
    ).toBe("complete|fulfilled");
    expect(readOutboundAttempts().slice(mark)).toEqual([]);
  });

  test("the status check reports two successful transactions per payment and staff are told", async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const mark = readOutboundAttempts().length;
    const payment = await pendingPayment(plans[2]);
    leftPending.push(payment.id);
    // Two successful transactions on one request, whose notices never arrived.
    ozow.addTransaction(payment.id, "Successful");
    ozow.addTransaction(payment.id, "Successful");
    const since = Date.now();
    // The payment-cleanup Worker's 10-minute run; up to 20 payments a run, the
    // never-checked first, so earlier leftovers can take a run or two.
    let errors: { paymentId: string | null; reason: string }[] = [];
    for (let run = 0; run < 5 && !errors.some((e) => e.paymentId === payment.id); run++) {
      const response = await request.post("/api/internal/payments/reconcile", {
        headers: { Authorization: `Bearer ${LOCAL_INTERNAL_JOBS_SECRET}` },
        maxRedirects: 0,
      });
      const body = await response.json();
      expect(Array.isArray(body.errors)).toBe(true);
      expect(response.status()).toBe(body.failures ? 503 : 200);
      expect(body.errors).toHaveLength(body.failures);
      errors = body.errors;
    }
    expect(errors).toContainEqual({ paymentId: payment.id, reason: "multiple_settlements" });
    await expect
      .poll(() => logged("Payment status check failed", payment.id))
      .toContainEqual({ paymentId: payment.id, reason: "multiple_settlements" });
    expect(logged("Payment problem", payment.id)).toContainEqual({
      paymentId: payment.id,
      reason: "multiple_settlements",
      source: "status_check",
      anomaly: "paid_twice",
    });
    // Nothing was settled automatically.
    expect(
      queryTestCopy(
        `select status, fulfillment_status from private.payments where id = '${payment.id}';`
      )
    ).toBe("pending|unfulfilled");
    const mail = await expectStaffAlert(request, payment, since, "(paid twice)");
    expect(mail.text).toContain("the 10-minute status check");
    expect(problem(payment.id, "multiple_settlements")).toMatchObject({
      source: "status_check",
      alert: true,
      emailed: true,
    });
    expect(serverLogMentions([member.email, member.lastName])).toEqual([]);
    expect(readOutboundAttempts().slice(mark)).toEqual([]);
  });
});
