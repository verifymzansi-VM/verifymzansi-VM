/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationServiceApi } from "./service-api";
import type { OzowRefundClient } from "../payments/ozow-refunds";

vi.mock("server-only", () => ({}));
vi.mock("../utils/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/config/env", () => ({ env: vi.fn(() => "") }));

const { runOzowRefundJobs, runOzowRefundReconciliation, sendOzowRefund } =
  await import("./ozow-refunds");
const { OzowRefundNotFoundError, OzowRefundUnavailableError } =
  await import("../payments/ozow-refunds");

const REQUEST = "11111111-2222-4333-8444-555555555555";
const TX = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
const REFUND = "b1fa5055-19c5-41ab-86dd-15272d103455";
const claimed = {
  request_id: REQUEST,
  claimed: true,
  status: "sent",
  attempt: 1,
  idempotency_key: `vm-refund-${REQUEST}`,
  transaction_id: TX,
  amount_cents: 6900,
  reason_code: "s14_cancellation",
};
const recorded = (status = "sent") => ({
  request_id: REQUEST,
  outcome: "pending",
  status,
  ozow_refund_id: REFUND,
  ozow_status: "Pending",
});

const rpc = vi.fn();
const service = { rpc } as unknown as FoundationServiceApi;
const client = {
  prepare: vi.fn(async () => {}),
  create: vi.fn(),
  get: vi.fn(),
  transactionRefunds: vi.fn(),
  list: vi.fn(),
} satisfies OzowRefundClient;
const answer = (answers: Record<string, unknown>) =>
  rpc.mockImplementation(async (name: string) => ({ data: answers[name], error: null }));
const calls = (name: string) => rpc.mock.calls.filter(([called]) => called === name);

beforeEach(() => {
  vi.clearAllMocks();
  client.prepare.mockResolvedValue(undefined);
});

describe("sending an approved refund", () => {
  it("claims it, sends Ozow the record's own key and stores Ozow's answer", async () => {
    answer({ claim_ozow_refund_send: claimed, record_ozow_refund_send: recorded() });
    client.create.mockResolvedValue({
      outcome: "accepted",
      fact: {
        refundId: REFUND,
        transactionId: TX,
        amountCents: 6900,
        status: "Pending",
        requestedAt: "2026-11-13T09:30:00.000Z",
        completedAt: null,
      },
    });
    await expect(sendOzowRefund(service, client, REQUEST)).resolves.toEqual({
      sent: true,
      status: "sent",
      answered: true,
    });
    expect(client.create).toHaveBeenCalledExactlyOnceWith({
      transactionId: TX,
      amountCents: 6900,
      reason: "VerifyMzansi refund: s14 cancellation",
      idempotencyKey: `vm-refund-${REQUEST}`,
    });
    expect(calls("record_ozow_refund_send")[0][1]).toEqual({
      p_request_id: REQUEST,
      p_result: {
        outcome: "accepted",
        refund_id: REFUND,
        transaction_id: TX,
        amount_cents: 6900,
        status: "Pending",
        requested_at: "2026-11-13T09:30:00.000Z",
        completed_at: null,
      },
    });
  });

  it("never calls Ozow when the database does not hand the record over", async () => {
    answer({ claim_ozow_refund_send: { request_id: REQUEST, claimed: false, status: "sent" } });
    await expect(sendOzowRefund(service, client, REQUEST)).resolves.toEqual({
      sent: false,
      status: "sent",
      reason: "not_claimed",
    });
    expect(client.create).not.toHaveBeenCalled();
    expect(calls("record_ozow_refund_send")).toHaveLength(0);
  });

  it("claims nothing when no refunds token can be had", async () => {
    client.prepare.mockRejectedValue(new OzowRefundUnavailableError("no key"));
    await expect(sendOzowRefund(service, client, REQUEST)).resolves.toMatchObject({
      sent: false,
      reason: "unavailable",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores an unreachable Ozow as unknown, and a refusal as refused", async () => {
    answer({ claim_ozow_refund_send: claimed, record_ozow_refund_send: recorded() });
    client.create.mockRejectedValueOnce(new OzowRefundUnavailableError("down"));
    await sendOzowRefund(service, client, REQUEST);
    client.create.mockResolvedValueOnce({
      outcome: "refused",
      failureReason: "ozow_refused",
      status: 400,
    });
    await sendOzowRefund(service, client, REQUEST);
    expect(calls("record_ozow_refund_send").map(([, args]) => args.p_result)).toEqual([
      { outcome: "unknown" },
      { outcome: "refused", failure_reason: "ozow_refused" },
    ]);
  });

  it("refuses a claim the database did not shape as expected", async () => {
    answer({ claim_ozow_refund_send: { ...claimed, idempotency_key: "other-key" } });
    await expect(sendOzowRefund(service, client, REQUEST)).rejects.toThrow();
    expect(client.create).not.toHaveBeenCalled();
  });
});

const fact = (overrides: Record<string, unknown> = {}) => ({
  refundId: REFUND,
  transactionId: TX,
  amountCents: 6900,
  status: "Complete",
  requestedAt: "2026-11-13T09:30:00.000Z",
  completedAt: null,
  ...overrides,
});

describe("the 10-minute job", () => {
  it("sends due refunds, then reads unsettled ones back from Ozow", async () => {
    answer({
      list_ozow_refund_sends_due: [REQUEST],
      claim_ozow_refund_send: { request_id: REQUEST, claimed: false, status: "applied" },
      claim_ozow_refund_checks: [
        {
          request_id: REQUEST,
          ozow_refund_id: REFUND,
          transaction_id: TX,
          amount_cents: 6900,
          sent_at: null,
        },
      ],
      apply_ozow_refund_status: { outcome: "applied" },
    });
    client.get.mockResolvedValue(fact());
    await expect(runOzowRefundJobs(service, client)).resolves.toEqual({
      attempted: 0,
      checked: 1,
      failures: 0,
    });
    expect(calls("list_ozow_refund_sends_due")[0][1]).toEqual({ p_limit: 2 });
    expect(calls("apply_ozow_refund_status")[0][1]).toMatchObject({
      p_event: { refund_id: REFUND, status: "Complete", source: "refund_check" },
    });
    expect(client.create).not.toHaveBeenCalled();
  });

  it("reports a refund Ozow does not have, and a lost send with nothing that fits", async () => {
    answer({
      list_ozow_refund_sends_due: [],
      claim_ozow_refund_checks: [
        {
          request_id: REQUEST,
          ozow_refund_id: REFUND,
          transaction_id: TX,
          amount_cents: 6900,
          sent_at: null,
        },
        {
          request_id: "22222222-2222-4333-8444-555555555555",
          ozow_refund_id: null,
          transaction_id: TX,
          amount_cents: 6900,
          sent_at: "2026-11-13T10:00:00.000Z",
        },
      ],
      report_ozow_refund_missing: { request_id: REQUEST, status: "sent", reported: true },
    });
    client.get.mockRejectedValue(new OzowRefundNotFoundError());
    // An earlier refund of the same amount (before the send) never fits.
    client.transactionRefunds.mockResolvedValue([
      fact({ requestedAt: "2026-11-12T08:00:00.000Z" }),
    ]);
    const result = await runOzowRefundJobs(service, client);
    expect(result.checked).toBe(2);
    expect(calls("report_ozow_refund_missing")).toHaveLength(2);
    expect(calls("apply_ozow_refund_status")).toHaveLength(0);
  });

  it("never reports a lost send missing while Ozow has a refund that could be it", async () => {
    answer({
      list_ozow_refund_sends_due: [],
      claim_ozow_refund_checks: [
        {
          request_id: REQUEST,
          ozow_refund_id: null,
          transaction_id: TX,
          amount_cents: 6900,
          sent_at: "2026-11-13T10:00:00.000Z",
        },
      ],
      apply_ozow_refund_status: { outcome: "unmatched" },
    });
    // No request time and another amount: it is still handed to the database.
    client.transactionRefunds.mockResolvedValue([fact({ requestedAt: null, amountCents: 6800 })]);
    await runOzowRefundJobs(service, client);
    expect(calls("report_ozow_refund_missing")).toHaveLength(0);
    expect(calls("apply_ozow_refund_status")).toHaveLength(1);
  });
  it("stops starting Ozow requests when its time is up", async () => {
    let now = 0;
    answer({ list_ozow_refund_sends_due: [REQUEST, REQUEST] });
    client.prepare.mockImplementation(async () => {
      now += 25_000;
      throw new OzowRefundUnavailableError("down");
    });
    const result = await runOzowRefundJobs(service, client, () => now);
    expect(client.prepare).toHaveBeenCalledOnce();
    expect(result).toEqual({ attempted: 0, checked: 0, failures: 1 });
    expect(calls("claim_ozow_refund_checks")).toHaveLength(0);
  });
});

describe("the daily check", () => {
  it("reads three days of Ozow refunds and changes nothing itself", async () => {
    answer({ reconcile_ozow_refunds: { checked: 1, unmatched: 1, mismatched: 0, stuck: 0 } });
    client.list.mockResolvedValue({ facts: [fact({ requestedAt: null })], unreadable: 0 });
    const now = new Date("2026-11-13T05:15:00Z");
    await expect(runOzowRefundReconciliation(service, client, now)).resolves.toMatchObject({
      unmatched: 1,
      listed: true,
    });
    expect(client.list).toHaveBeenCalledWith(new Date("2026-11-10T05:15:00Z"), now);
    expect(client.create).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["reconcile_ozow_refunds"]);
  });

  it("still checks for stuck refunds when Ozow's list cannot be read", async () => {
    answer({ reconcile_ozow_refunds: { checked: 0, unmatched: 0, mismatched: 0, stuck: 2 } });
    client.list.mockRejectedValue(new OzowRefundUnavailableError("down"));
    await expect(runOzowRefundReconciliation(service, client)).resolves.toMatchObject({
      stuck: 2,
      listed: false,
    });
    expect(calls("reconcile_ozow_refunds")[0][1]).toEqual({ p_refunds: [] });
  });
});
