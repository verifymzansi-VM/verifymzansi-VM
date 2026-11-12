/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  paymentAlertEmail,
  paymentAlertRecipients,
  paymentSummaryEmail,
  runFoundationPaymentAlerts,
  type PaymentAlertContext,
} from "./payment-alerts";

const logged = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../services/email", () => ({ sendStaffOperationsEmail: vi.fn() }));
vi.mock("../utils/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), ...logged }),
}));

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const CLAIM = uuid(90);
const STAFF = ["owner@example.test", "deputy@example.test"];
const problem = (
  n: number,
  reason = "amount_mismatch",
  change: { source?: "notice" | "status_check" } = {}
) => ({
  id: uuid(n),
  payment_id: uuid(100 + n),
  reason,
  source: "notice" as "notice" | "status_check",
  first_seen_at: "2026-11-12T07:58:00.123456+00:00",
  merchant_reference: `ref${n}`.padEnd(32, "0"),
  amount_cents: "5000",
  status: "pending",
  fulfillment_status: "unfulfilled",
  product_kind: "plan",
  ...change,
});
const digest = (change: Record<string, unknown> = {}) => ({
  day: "2026-11-12",
  claim: uuid(91),
  window_start: "2026-11-11T05:00:00+00:00",
  window_end: "2026-11-12T05:00:00+00:00",
  problems: {
    total: 2,
    items: [
      {
        payment_id: uuid(101),
        reason: "multiple_settlements",
        source: "status_check" as const,
        first_seen_at: "2026-11-11T09:00:00+00:00",
        last_seen_at: "2026-11-12T04:50:00+00:00",
        occurrences: 30,
        needs_alert: true,
        alerted: true,
      },
      {
        payment_id: null,
        reason: "unknown_payment",
        source: "notice" as const,
        first_seen_at: "2026-11-01T09:00:00+00:00",
        last_seen_at: "2026-11-11T10:00:00+00:00",
        occurrences: 1,
        needs_alert: false,
        alerted: false,
      },
    ],
  },
  not_activated: { total: 1, payment_ids: [uuid(102)] },
  stale_pending: { total: 0, payment_ids: [] },
  unalerted: 0,
  outcomes: { completed: 4, not_paid: 2, multiple_unknown_thing: 1 },
  ...change,
});

const call = vi.fn();
const send = vi.fn();
const pace = vi.fn(async <T>(work: () => Promise<T>) => work());
let fits = true;
const context: PaymentAlertContext = {
  call,
  claimSignal: () => AbortSignal.timeout(1000),
  canClaim: () => fits,
  pace: pace as PaymentAlertContext["pace"],
};
const answers = (alerts: unknown, summary: unknown = null) =>
  call.mockImplementation(async (name: string) => {
    if (name === "claim_payment_alerts") return { data: alerts, error: null };
    if (name === "claim_payment_digest") return { data: summary, error: null };
    if (name === "complete_payment_alerts") return { data: 1, error: null };
    if (name === "complete_payment_digest") return { data: true, error: null };
    return { data: null, error: { message: "unexpected" } };
  });
const run = (recipients: string[] | null = STAFF) =>
  runFoundationPaymentAlerts(context, { send, recipients: () => recipients });
const names = () => call.mock.calls.map(([name]) => name);

beforeEach(() => {
  vi.clearAllMocks();
  fits = true;
  send.mockResolvedValue({ success: true, messageId: "synthetic" });
  answers({ claim: null, problems: [] });
});

describe("the staff addresses", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["  ", null],
    ["owner@example.test", ["owner@example.test"]],
    [" owner@example.test , deputy@example.test ", STAFF],
    [
      "a@example.test,b@example.test,c@example.test",
      ["a@example.test", "b@example.test", "c@example.test"],
    ],
  ])("reads %j as %j", (value, expected) => {
    expect(paymentAlertRecipients({ PAYMENT_ALERT_EMAILS: value })).toEqual(expected);
    expect(logged.error).not.toHaveBeenCalled();
  });

  it.each([
    "a@example.test,b@example.test,c@example.test,d@example.test",
    "not-an-address",
    "owner@example.test,",
    "owner@example.test,OWNER@example.test",
  ])("refuses %j loudly, naming only the setting", (value) => {
    expect(paymentAlertRecipients({ PAYMENT_ALERT_EMAILS: value })).toBeNull();
    expect(logged.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain("example.test");
  });
});

describe("the alert at once", () => {
  it("sends nothing and fails nothing when there is nothing to report", async () => {
    expect(await run()).toEqual([]);
    expect(names()).toEqual(["claim_payment_alerts", "claim_payment_digest"]);
    expect(call.mock.calls[0]).toEqual([
      "claim_payment_alerts",
      { p_limit: 20 },
      context.claimSignal,
    ]);
    expect(call.mock.calls[1]).toEqual([
      "claim_payment_digest",
      { p_from_hour: 7, p_limit: 20 },
      context.claimSignal,
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("emails every claimed problem once, paced, then records it as sent", async () => {
    answers({ claim: CLAIM, problems: [problem(1), problem(2, "conflicting_transaction")] });
    expect(await run()).toEqual([]);
    expect(pace).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    const email = send.mock.calls[0][0];
    expect(email.to).toEqual(STAFF);
    expect(email.subject).toBe(
      "VerifyMzansi payment alert: 2 payments need attention (wrong amount, paid twice)"
    );
    expect(email.idempotencyKey).toMatch(/^payment-alert\/[0-9a-f]{64}$/);
    expect(email.sections[0]).toEqual({
      heading: "Wrong amount",
      rows: [
        ["Payment number", uuid(101)],
        ["Ozow reference", problem(1).merchant_reference],
        ["Amount", "R 50.00"],
        ["Payment", "plan, pending, unfulfilled"],
        ["Found by", "the payment notice"],
        ["First seen", expect.stringMatching(/12 Nov 2026.*09:58/)],
      ],
    });
    expect(call).toHaveBeenCalledWith("complete_payment_alerts", { p_claim: CLAIM });
  });

  it("gives the same set of problems the same key, whatever the order", () => {
    const one = paymentAlertEmail(STAFF, [problem(1), problem(2)]);
    const two = paymentAlertEmail(STAFF, [problem(2), problem(1)]);
    const other = paymentAlertEmail(STAFF, [problem(1), problem(3)]);
    expect(one.idempotencyKey).toBe(two.idempotencyKey);
    expect(other.idempotencyKey).not.toBe(one.idempotencyKey);
  });

  it("names a second transaction as paid twice, and each anomaly kind once", () => {
    const email = paymentAlertEmail(
      ["owner@example.test"],
      [
        problem(1, "transaction_id_mismatch"),
        problem(2, "complete_unfulfillable_target", { source: "status_check" }),
        problem(3, "refunded_after_completion"),
        problem(4, "currency_mismatch"),
        problem(5, "amount_mismatch"),
      ]
    );
    expect(email.subject).toBe(
      "VerifyMzansi payment alert: 5 payments need attention (paid twice, paid but not activated, money returned after activation, wrong amount)"
    );
    expect(email.sections[1].rows).toContainEqual(["Found by", "the 10-minute status check"]);
    expect(paymentAlertEmail(STAFF, [problem(1)]).subject).toBe(
      "VerifyMzansi payment alert: 1 payment needs attention (wrong amount)"
    );
  });

  it("counts a refused repeat of its own request as sent", async () => {
    answers({ claim: CLAIM, problems: [problem(1)] });
    send.mockResolvedValue({ success: false, outcomeUnknown: true });
    expect(await run()).toEqual([]);
    expect(names()).toContain("complete_payment_alerts");
  });

  it.each([
    ["refused", () => send.mockResolvedValue({ success: false, error: "provider refused" })],
    ["thrown", () => send.mockRejectedValue(new Error("PRIVATE_PROVIDER_DETAIL"))],
  ])("leaves a %s alert for the next lease and fails the step", async (_case, arrange) => {
    answers({ claim: CLAIM, problems: [problem(1)] });
    arrange();
    expect(await run()).toEqual(["payment_alert"]);
    expect(names()).not.toContain("complete_payment_alerts");
    expect(logged.error).toHaveBeenCalledWith("Payment alert email failed", {
      problems: [{ paymentId: uuid(101), reason: "amount_mismatch" }],
    });
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain("PRIVATE");
  });

  it("without staff addresses, logs the problems loudly and leaves them for later", async () => {
    answers({ claim: CLAIM, problems: [problem(1)] });
    expect(await run(null)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(names()).not.toContain("complete_payment_alerts");
    expect(logged.error).toHaveBeenCalledWith(
      "Payment alert not emailed: no recipients configured",
      {
        setting: "PAYMENT_ALERT_EMAILS",
        problems: [{ paymentId: uuid(101), reason: "amount_mismatch" }],
      }
    );
  });

  it.each([
    ["a database error", { data: null, error: { code: "42883" } }],
    ["an unreadable answer", { data: { claim: "x", problems: [] }, error: null }],
    ["a problem it cannot read", { data: { claim: CLAIM, problems: [{}] }, error: null }],
  ])("reports %s on the claim and still runs the summary", async (_case, answer) => {
    call.mockImplementation(async (name: string) =>
      name === "claim_payment_alerts" ? answer : { data: null, error: null }
    );
    expect(await run()).toEqual(["payment_alert:claim"]);
    expect(names()).toContain("claim_payment_digest");
    expect(send).not.toHaveBeenCalled();
  });

  it("reports an alert it sent but could not record", async () => {
    answers({ claim: CLAIM, problems: [problem(1)] });
    const base = call.getMockImplementation()!;
    call.mockImplementation(async (name: string, args: unknown) =>
      name === "complete_payment_alerts"
        ? { data: null, error: { code: "57P01" } }
        : base(name, args)
    );
    expect(await run()).toEqual(["payment_alert:complete"]);
  });

  it("claims nothing when a worst-case send no longer fits", async () => {
    fits = false;
    expect(await run()).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("the daily summary", () => {
  it("sends the day's summary once, with its own key, then records it", async () => {
    answers({ claim: null, problems: [] }, digest());
    expect(await run()).toEqual([]);
    expect(send).toHaveBeenCalledOnce();
    const email = send.mock.calls[0][0];
    expect(email).toMatchObject({
      to: STAFF,
      idempotencyKey: "payment-summary/2026-11-12",
      subject: "VerifyMzansi payment summary 2026-11-12: 2 problems, 1 waiting for staff",
      tone: "warning",
    });
    expect(email.intro).toMatch(/11 Nov 2026.*07:00 to 12 Nov 2026.*07:00/);
    expect(call).toHaveBeenCalledWith("complete_payment_digest", { p_claim: uuid(91) });
  });

  it("lists the activity, the problems and what still waits for staff", () => {
    const email = paymentSummaryEmail(STAFF, digest());
    expect(email.sections[0].rows).toEqual([
      ["Paid and activated", "4"],
      ["multiple_unknown_thing", "1"],
      ["Not paid (declined or cancelled at the bank)", "2"],
    ]);
    expect(email.sections[1].heading).toBe("Problems in this period: 2");
    expect(email.sections[1].rows[0]).toEqual([
      "Paid twice: the status check found two successful transactions",
      expect.stringMatching(
        new RegExp(`^${uuid(101)}; seen 30 times, last 12 Nov 2026.*06:50; alert sent$`)
      ),
    ]);
    expect(email.sections[1].rows[1][1]).toMatch(/^no payment matched; seen 1 time, last /);
    expect(email.sections[2].rows).toEqual([
      ["Paid but not activated", "1"],
      ["Payment number", uuid(102)],
      ["Pending with an Ozow request for over 2 hours", "0"],
      ["Problems not emailed yet", "0"],
    ]);
    // Payment numbers and counts only: no account id, no address but the staff's.
    expect(JSON.stringify(email.sections)).not.toMatch(/owner|@/);
  });

  it("says so when there is nothing to report", () => {
    const email = paymentSummaryEmail(
      STAFF,
      digest({
        problems: { total: 0, items: [] },
        not_activated: { total: 0, payment_ids: [] },
        outcomes: {},
      })
    );
    expect(email.subject).toBe("VerifyMzansi payment summary 2026-11-12: no payment problems");
    expect(email.tone).toBe("info");
    expect(email.sections[0].rows).toEqual([["Recorded", "none"]]);
    expect(email.sections[1].rows).toEqual([["Problems", "none"]]);
  });

  it("says how many problems it left out", () => {
    const email = paymentSummaryEmail(
      STAFF,
      digest({ problems: { ...digest().problems, total: 45 } })
    );
    expect(email.sections[1].heading).toBe(
      "Problems in this period: 45 (the 2 most important are listed)"
    );
  });

  it("leaves a summary that could not be sent for the next lease", async () => {
    answers({ claim: null, problems: [] }, digest());
    send.mockResolvedValue({ success: false });
    expect(await run()).toEqual(["payment_summary"]);
    expect(names()).not.toContain("complete_payment_digest");
  });

  it("without staff addresses, logs the day's counts once instead", async () => {
    answers({ claim: null, problems: [] }, digest());
    expect(await run(null)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(logged.error).toHaveBeenCalledWith(
      "Daily payment summary not emailed: no recipients configured",
      {
        setting: "PAYMENT_ALERT_EMAILS",
        day: "2026-11-12",
        problems: 2,
        notActivated: 1,
        stalePending: 0,
        unalerted: 0,
      }
    );
    expect(call).toHaveBeenCalledWith("complete_payment_digest", { p_claim: uuid(91) });
  });

  it.each([
    ["a database error", { data: null, error: { code: "57P01" } }],
    ["an unreadable answer", { data: { day: "today" }, error: null }],
  ])("reports %s on the summary claim", async (_case, answer) => {
    call.mockImplementation(async (name: string) =>
      name === "claim_payment_digest"
        ? answer
        : { data: { claim: null, problems: [] }, error: null }
    );
    expect(await run()).toEqual(["payment_summary:claim"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("passes another starting hour when given one", async () => {
    await runFoundationPaymentAlerts(context, { send, recipients: () => STAFF, fromHour: 0 });
    expect(call).toHaveBeenCalledWith(
      "claim_payment_digest",
      { p_from_hour: 0, p_limit: 20 },
      context.claimSignal
    );
  });
});
