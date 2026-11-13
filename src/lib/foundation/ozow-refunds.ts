import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import {
  hasDatabaseMessage,
  lookupDatabaseReason,
  type FoundationErrorReason,
} from "./error-reasons";
import { staffReason } from "./organisations";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";
import { refundReasonCode, type RefundReasonCode } from "./staff-payments";
import {
  OzowRefundNotFoundError,
  OzowRefundUnavailableError,
  type OzowRefundClient,
  type OzowRefundFact,
} from "../payments/ozow-refunds";
import { createLogger } from "../utils/logger";

/**
 * Staff refunds sent to Ozow by the server (update
 * 20261113172356_ozow_api_refunds.sql). The database decides everything:
 * who may refund, the R1,000 second-approver rule, one refund in flight per
 * payment, and that a record is handed to the sender once. This module only
 * carries the database's decisions to Ozow and Ozow's answers back:
 *
 * - send: claim the approved record (the database marks it "sent" once), call
 *   Ozow with the record's own Idempotency-Key, store Ozow's answer;
 * - notice: a signed refund notice names a refund; its status is read back
 *   from Ozow and applied (only Complete reverses the payment or slot);
 * - check: once a day, Ozow's refund list by date is compared with the records
 *   (alerts only).
 */

const log = createLogger("OzowRefunds");

const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });
const recordStatus = z.enum([
  "awaiting_approval",
  "approved",
  "sent",
  "applied",
  "failed",
  "returned",
  "declined",
]);
export type OzowRefundRecordStatus = z.infer<typeof recordStatus>;
const paymentStatus = z.enum([
  "pending",
  "complete",
  "failed",
  "expired",
  "refunded",
  "chargeback",
  "cancelled",
]);

const commandResult = z.strictObject({
  request_id: z.uuid(),
  status: recordStatus,
  channel: z.enum(["api", "dashboard"]),
  kind: z.literal("refunded"),
  line_id: z.uuid().nullable(),
  amount_cents: cents,
  needs_approval: z.boolean(),
  released_activations: count.nullable(),
  payment_status: paymentStatus,
  repeated: z.boolean(),
});
export type StaffOzowRefundResult = z.infer<typeof commandResult>;

const approveResult = z.strictObject({
  request_id: z.uuid(),
  status: recordStatus,
  kind: z.enum(["refunded", "chargeback"]),
  released_activations: count.nullable(),
  payment_status: paymentStatus,
  repeated: z.boolean(),
});

/** Refusals staff can act on, in plain words. */
const REFUSALS: ReadonlyMap<FoundationErrorReason, [number, string]> = new Map([
  ["refund_reason_code_invalid", [422, "Choose why the money is returned."]],
  ["ozow_refund_id_required", [422, "Enter Ozow's refund id from the Ozow dashboard."]],
  [
    "ozow_refund_id_used",
    [409, "That Ozow refund was already recorded. Reload the page to see it."],
  ],
  ["ozow_reference_used", [409, "That Ozow refund was already recorded with its reference."]],
  [
    "payment_not_ozow",
    [409, "This payment was not paid through Ozow. Record its refund with its reference."],
  ],
  ["payment_not_refundable", [409, "This payment or slot was already refunded. Reload the page."]],
  [
    "payment_slot_reversed",
    [409, "A slot of this payment was already refunded. Refund the other slots one by one."],
  ],
  [
    "refund_awaiting_approval",
    [409, "A refund of this payment is waiting for approval. Approve or decline it first."],
  ],
  [
    "refund_in_flight",
    [409, "A refund of this payment is on its way through Ozow. Wait for Ozow's answer."],
  ],
  ["refund_not_waiting", [409, "This refund is no longer waiting for approval. Reload the page."]],
  [
    "refund_payment_changed",
    [409, "The payment changed since this refund was recorded. Decline it and record it again."],
  ],
  [
    "refund_approver_same",
    [403, "Another staff member must approve this refund: you recorded it."],
  ],
  ["refund_closer_same", [403, "Another staff member must close this refund: you recorded it."]],
  [
    "refund_ozow_failed",
    [409, "Ozow has no paid refund with this id. Decline this record instead of approving it."],
  ],
  [
    "refund_not_closable",
    [409, "Only a refund that never reached Ozow can be closed. Reload the page to see its state."],
  ],
  [
    "staff_review_required",
    [403, "You need a current accepted ID review of your own to change payments."],
  ],
  ["staff_same_identity", [403, "Another staff member must handle a payment of your own."]],
]);

async function settle<T>(
  result: PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string; details?: string } | null;
  }>,
  schema: z.ZodType<T>
): Promise<T> {
  const settled = await result;
  const refusal = lookupDatabaseReason(REFUSALS, settled.error);
  if (refusal) throw new FoundationStaffCommandError(refusal[0], refusal[1]);
  if (hasDatabaseMessage(settled.error, "staffOwnReviewRequired"))
    throw new FoundationStaffCommandError(
      403,
      "You need an accepted ID review of your own to change payments."
    );
  return settleStaffCommand(Promise.resolve(settled), schema);
}

export type StaffOzowRefundInput = {
  paymentId: string;
  /** One slot of the payment, or null for the whole payment. */
  lineId: string | null;
  reasonCode: RefundReasonCode;
  reason: string;
};

/** Records a refund for the server to send to Ozow (no reference to type). */
export function requestStaffOzowRefund(
  api: FoundationAuthenticatedApi,
  input: StaffOzowRefundInput
) {
  return settle(
    api.rpc(
      "request_staff_ozow_refund",
      {
        p_payment_id: input.paymentId,
        p_line_id: input.lineId,
        p_reason_code: refundReasonCode.parse(input.reasonCode),
        p_reason: staffReason.parse(input.reason),
      },
      { get: false }
    ),
    commandResult
  );
}

const ozowRefundId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
  .transform((value) => value.toLowerCase());

/** Records a refund an admin made by hand in the Ozow dashboard. */
export function recordStaffDashboardRefund(
  api: FoundationAuthenticatedApi,
  input: StaffOzowRefundInput & { ozowRefundId: string }
) {
  const refundId = ozowRefundId.safeParse(input.ozowRefundId);
  if (!refundId.success)
    throw new FoundationStaffCommandError(
      422,
      "Ozow's refund id is the long code shown with the refund in the Ozow dashboard (8-4-4-4-12 letters and digits)."
    );
  return settle(
    api.rpc(
      "record_staff_dashboard_refund",
      {
        p_payment_id: input.paymentId,
        p_line_id: input.lineId,
        p_reason_code: refundReasonCode.parse(input.reasonCode),
        p_reason: staffReason.parse(input.reason),
        p_ozow_refund_id: refundId.data,
      },
      { get: false }
    ),
    commandResult
  );
}

/** Another staff member closes a refund through Ozow that never reached Ozow. */
export function closeStaffOzowRefund(
  api: FoundationAuthenticatedApi,
  requestId: string,
  reason: string
) {
  return settle(
    api.rpc(
      "close_staff_ozow_refund",
      { p_request_id: requestId, p_reason: staffReason.parse(reason) },
      { get: false }
    ),
    z.strictObject({
      request_id: z.literal(requestId),
      status: z.literal("failed"),
      repeated: z.boolean(),
    })
  );
}

/** A second staff member approves a waiting refund (any channel). */
export function approveStaffRefund(api: FoundationAuthenticatedApi, requestId: string) {
  return settle(
    api.rpc("approve_staff_payment_refund", { p_request_id: requestId }, { get: false }),
    approveResult
  );
}

const refundRecord = z.strictObject({
  id: z.uuid(),
  payment_id: z.uuid(),
  line_id: z.uuid().nullable(),
  channel: z.enum(["api", "dashboard"]),
  status: recordStatus,
  amount_cents: cents,
  reason_code: refundReasonCode,
  needs_approval: z.boolean(),
  requested_at: instant,
  approved_at: instant.nullable(),
  sent_at: instant.nullable(),
  applied_at: instant.nullable(),
  failed_at: instant.nullable(),
  returned_at: instant.nullable(),
  failure_reason: z
    .enum([
      "ozow_refused",
      "ozow_auth",
      "ozow_failed",
      "ozow_cancelled",
      "ozow_invalid",
      "payment_changed",
      "closed_by_staff",
    ])
    .nullable(),
  ozow_refund_id: z.uuid().nullable(),
  ozow_status: z
    .enum([
      "Pending",
      "Submitted",
      "Complete",
      "Failed",
      "Cancelled",
      "Returned",
      "Invalid",
      "PendingInvestigation",
      "Error",
    ])
    .nullable(),
  ozow_status_at: instant.nullable(),
  send_outcome: z.enum(["unknown", "accepted", "refused"]).nullable(),
  send_attempts: z.number().int().min(0).max(3),
  ozow_missing_at: instant.nullable(),
  requested_by_me: z.boolean(),
});
export type StaffOzowRefundRecord = z.infer<typeof refundRecord>;

/** API and dashboard refunds of the listed payments, and those needing staff. */
export function readStaffOzowRefunds(api: FoundationAuthenticatedApi, paymentIds: string[]) {
  return settle(
    api.rpc("get_staff_ozow_refunds", { p_payment_ids: paymentIds }, { get: false }),
    z.strictObject({
      typed_reference_retired: z.boolean(),
      payments: z
        .array(z.strictObject({ payment_id: z.uuid(), ozow_refundable: z.boolean() }))
        .max(50),
      records: z.array(refundRecord).max(2_000),
      attention: z.array(refundRecord).max(20),
    })
  );
}

// ---------------------------------------------------------------- service

type ServiceResult = { data: unknown; error: { code?: string; message?: string } | null };
type RefundCommand =
  | "claim_ozow_refund_send"
  | "claim_ozow_refund_checks"
  | "report_ozow_refund_missing"
  | "list_ozow_refund_sends_due"
  | "record_ozow_refund_send"
  | "apply_ozow_refund_status"
  | "reconcile_ozow_refunds";
/** One service command; its arguments are checked by the database, its answer here. */
async function call<T>(
  service: FoundationServiceApi,
  name: RefundCommand,
  args: Record<string, unknown>,
  schema: z.ZodType<T>
): Promise<T> {
  const rpc = service.rpc as unknown as (
    name: RefundCommand,
    args: Record<string, unknown>
  ) => PromiseLike<ServiceResult>;
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(`${name} failed (${error.code ?? "unknown"})`);
  return schema.parse(data);
}

const claimed = z.union([
  z.strictObject({ request_id: z.uuid(), claimed: z.literal(false), status: recordStatus }),
  z.strictObject({
    request_id: z.uuid(),
    claimed: z.literal(true),
    status: z.literal("sent"),
    attempt: z.number().int().min(1).max(3),
    idempotency_key: z.string().regex(/^vm-refund-[0-9a-f-]{36}$/),
    transaction_id: z.uuid(),
    amount_cents: cents,
    reason_code: refundReasonCode,
  }),
]);
const sendRecorded = z.strictObject({
  request_id: z.uuid(),
  outcome: z.enum([
    "applied",
    "failed",
    "returned",
    "pending",
    "recorded",
    "unchanged",
    "flagged",
    "stuck",
    "mismatch",
  ]),
  status: recordStatus,
  ozow_refund_id: z.uuid().nullable(),
  ozow_status: z.string().nullable(),
});

/** What staff are told after a send. */
export type OzowRefundSendOutcome =
  | { sent: true; status: OzowRefundRecordStatus; answered: boolean }
  | { sent: false; status: OzowRefundRecordStatus | null; reason: "not_claimed" | "unavailable" };

const factForDatabase = (fact: OzowRefundFact) => ({
  refund_id: fact.refundId,
  transaction_id: fact.transactionId,
  amount_cents: fact.amountCents,
  status: fact.status,
  requested_at: fact.requestedAt,
  completed_at: fact.completedAt,
});

/** Fixed words for Ozow: the reason code only, never staff notes. */
const ozowReason = (code: RefundReasonCode) => `VerifyMzansi refund: ${code.replace(/_/g, " ")}`;

/**
 * Sends one approved API refund to Ozow, at most once per claim: the database
 * hands the record over only while it is approved (or an unknown send is due
 * a retry), and Ozow receives the record's own Idempotency-Key every time.
 * Never throws for Ozow's answers; an unreachable Ozow leaves the record sent
 * with an unknown outcome for the retry and the daily check.
 */
export async function sendOzowRefund(
  service: FoundationServiceApi,
  client: OzowRefundClient,
  requestId: string
): Promise<OzowRefundSendOutcome> {
  try {
    await client.prepare();
  } catch (error) {
    // Nothing is claimed: the 10-minute job tries again later.
    log.error("Ozow refund not sent: no refunds token", {
      requestId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { sent: false, status: null, reason: "unavailable" };
  }
  const claim = await call(service, "claim_ozow_refund_send", { p_request_id: requestId }, claimed);
  if (!claim.claimed) return { sent: false, status: claim.status, reason: "not_claimed" };
  let result;
  try {
    result = await client.create({
      transactionId: claim.transaction_id,
      amountCents: claim.amount_cents,
      reason: ozowReason(claim.reason_code),
      idempotencyKey: claim.idempotency_key,
    });
  } catch (error) {
    if (!(error instanceof OzowRefundUnavailableError)) throw error;
    result = { outcome: "unknown" as const, status: null };
  }
  const payload =
    result.outcome === "accepted"
      ? { outcome: "accepted", ...factForDatabase(result.fact) }
      : result.outcome === "refused"
        ? { outcome: "refused", failure_reason: result.failureReason }
        : { outcome: "unknown" };
  log.info("Ozow refund sent", {
    requestId,
    attempt: claim.attempt,
    outcome: result.outcome,
    ...(result.outcome === "accepted" ? {} : { httpStatus: result.status }),
  });
  const recorded = await call(
    service,
    "record_ozow_refund_send",
    { p_request_id: requestId, p_result: payload },
    sendRecorded
  );
  // "answered": Ozow gave its refund id (the refund exists at Ozow).
  return { sent: true, status: recorded.status, answered: recorded.ozow_refund_id !== null };
}

/** How long the 10-minute job may spend on refunds before it stops starting
 * new Ozow requests (each waits at most 15 seconds, twice with a token). */
const JOB_BUDGET_MS = 20_000;

const checkItem = z.strictObject({
  request_id: z.uuid(),
  ozow_refund_id: z.uuid().nullable(),
  transaction_id: z.uuid(),
  amount_cents: cents,
  sent_at: instant.nullable(),
});

/**
 * The 10-minute job: approved refunds whose own send did not happen and
 * unknown sends due a retry (same Idempotency-Key), then refunds without a
 * final answer, read back from Ozow (by refund id, or among the transaction's
 * refunds for a send whose answer was lost). A refund Ozow does not have is
 * reported and staff are alerted. Within a time budget; never throws.
 */
export async function runOzowRefundJobs(
  service: FoundationServiceApi,
  client: OzowRefundClient,
  clock = () => Date.now(),
  /** False while the switch is off: only read refunds back, never send. */
  send = true
): Promise<{ attempted: number; checked: number; failures: number }> {
  const started = clock();
  const inBudget = () => clock() - started < JOB_BUDGET_MS;
  let attempted = 0;
  let checked = 0;
  let failures = 0;
  const failed = (step: string, id: string, error: unknown) => {
    failures++;
    log.error("Ozow refund job step failed", {
      step,
      requestId: id,
      error: error instanceof Error ? error.name : "unknown",
    });
  };
  try {
    const due = send
      ? await call(service, "list_ozow_refund_sends_due", { p_limit: 2 }, z.array(z.uuid()).max(20))
      : [];
    for (const id of due) {
      if (!inBudget()) break;
      try {
        const outcome = await sendOzowRefund(service, client, id);
        if (outcome.sent) attempted++;
        else if (outcome.reason === "unavailable") failures++;
      } catch (error) {
        failed("send", id, error);
      }
    }
    if (!inBudget()) return { attempted, checked, failures };
    const items = await call(
      service,
      "claim_ozow_refund_checks",
      { p_limit: 3 },
      z.array(checkItem).max(20)
    );
    for (const item of items) {
      if (!inBudget()) break;
      try {
        await checkOzowRefund(service, client, item);
        checked++;
      } catch (error) {
        failed("check", item.request_id, error);
      }
    }
  } catch (error) {
    failed("list", "none", error);
  }
  return { attempted, checked, failures };
}

const reported = z.strictObject({
  request_id: z.uuid(),
  status: recordStatus,
  reported: z.boolean(),
});

async function checkOzowRefund(
  service: FoundationServiceApi,
  client: OzowRefundClient,
  item: z.infer<typeof checkItem>
) {
  const missing = () =>
    call(service, "report_ozow_refund_missing", { p_request_id: item.request_id }, reported);
  if (item.ozow_refund_id) {
    let fact: OzowRefundFact;
    try {
      fact = await client.get(item.ozow_refund_id);
    } catch (error) {
      if (error instanceof OzowRefundNotFoundError) return void (await missing());
      throw error;
    }
    await applyOzowRefundFact(service, fact, "refund_check");
    return;
  }
  // A send whose answer was lost. "Missing" is reported only when Ozow's full
  // list of the transaction's refunds has none that could be it: none
  // requested after (or up to ten minutes before) the send, and none without a
  // request time, whatever the amount. Every refund that could be it goes to
  // the database, which links exactly one fit (an id recorded nowhere else) or
  // raises an unmatched-refund alert, which also blocks closing the record.
  const sentAt = item.sent_at ? Date.parse(item.sent_at) - 10 * 60 * 1000 : -Infinity;
  const couldBe = (await client.transactionRefunds(item.transaction_id)).filter(
    (fact) => fact.requestedAt === null || Date.parse(fact.requestedAt) >= sentAt
  );
  if (couldBe.length === 0) return void (await missing());
  for (const fact of couldBe) await applyOzowRefundFact(service, fact, "refund_check");
}

const applied = z.looseObject({
  outcome: z.enum([
    "applied",
    "failed",
    "returned",
    "pending",
    "recorded",
    "unchanged",
    "flagged",
    "unmatched",
    "mismatch",
  ]),
});

/** Applies a refund status read back from Ozow (never the notice's own body). */
export async function applyOzowRefundFact(
  service: FoundationServiceApi,
  fact: OzowRefundFact,
  source: "refund_notice" | "refund_check"
) {
  return call(
    service,
    "apply_ozow_refund_status",
    { p_event: { ...factForDatabase(fact), source } },
    applied
  );
}

/** How far back the daily check reads Ozow's refund list. */
const CHECK_DAYS = 3;

const reconciled = z.strictObject({
  checked: count,
  unmatched: count,
  mismatched: count,
  stuck: count,
});

/**
 * The daily check: reads Ozow's refunds requested in the last three days and
 * lets the database raise an alert for any refund with no record of ours, any
 * record that differs, and any API refund stuck for more than a day. Changes
 * no refund. When Ozow's list cannot be read, the stuck check still runs and
 * the run is reported as failed (`listed: false`); entries this site cannot
 * read are counted (`unreadable`) and fail the run too.
 */
export async function runOzowRefundReconciliation(
  service: FoundationServiceApi,
  client: OzowRefundClient,
  now = new Date()
) {
  const from = new Date(now.getTime() - CHECK_DAYS * 24 * 60 * 60 * 1000);
  let listed: Awaited<ReturnType<OzowRefundClient["list"]>> | null = null;
  try {
    listed = await client.list(from, now);
  } catch (error) {
    log.error("Ozow refund list could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  if (listed && listed.unreadable > 0)
    log.error("Ozow refund list had entries this site cannot read", {
      unreadable: listed.unreadable,
    });
  const result = await call(
    service,
    "reconcile_ozow_refunds",
    { p_refunds: (listed?.facts ?? []).map(factForDatabase) },
    reconciled
  );
  return { ...result, listed: listed !== null, unreadable: listed?.unreadable ?? 0 };
}
