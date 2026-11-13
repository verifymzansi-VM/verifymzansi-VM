import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  hasDatabaseMessage,
  lookupDatabaseReason,
  type FoundationErrorReason,
} from "./error-reasons";
import { staffReason } from "./organisations";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";

const actualStatuses = [
  "pending",
  "complete",
  "failed",
  "expired",
  "refunded",
  "chargeback",
  "cancelled",
] as const;
/** The staff list's filters: a payment status, or the two staff work lists. */
export const staffPaymentListFilter = z.enum([
  ...actualStatuses,
  "processing",
  "needs_attention",
  "awaiting_approval",
]);
export type StaffPaymentListFilter = z.infer<typeof staffPaymentListFilter>;

/** Why a refund or chargeback was recorded (the owner's closed list). */
export const REFUND_REASON_CODES = [
  "billing_error",
  "duplicate",
  "our_failure_after_fix_offered",
  "s14_cancellation",
  "breach_credit",
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];
export const refundReasonCode = z.enum(REFUND_REASON_CODES);

/** Ozow's refund (or chargeback) reference, as the database accepts it. */
export const ozowReference = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{3,99}$/);

/** Refunds above this many cents wait for a second staff member. */
export const REFUND_APPROVAL_ABOVE_CENTS = 100_000;

const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const staffPaymentItem = z.strictObject({
  id: z.uuid(),
  user_id: z.uuid(),
  area: z.enum(["market", "business", "tourism_events", "all"]),
  amount_cents: cents,
  status: z.enum(actualStatuses),
  fulfillment_status: z.enum(["unfulfilled", "fulfilled", "needs_reconciliation", "reversed"]),
  product_kind: z.enum(["plan", "addon"]),
  created_at: z.iso.datetime({ offset: true }),
  completed_at: z.iso.datetime({ offset: true }).nullable(),
  merchant_reference: z.string().min(1).max(100),
  description: z.string().min(1).max(160),
  reversed: z.boolean(),
  activated_at: z.iso.datetime({ offset: true }).nullable(),
  lines: z
    .array(
      z.strictObject({
        id: z.uuid(),
        line_number: z.number().int().min(1).max(25),
        amount_cents: cents,
        status: z.enum(["open", "reversed"]),
        reversal_kind: z.enum(["refunded", "chargeback"]).nullable(),
      })
    )
    .max(25),
  refund_request: z
    .strictObject({
      id: z.uuid(),
      line_id: z.uuid().nullable(),
      kind: z.enum(["refunded", "chargeback"]),
      reason_code: refundReasonCode,
      amount_cents: cents,
      ozow_reference: z.string().min(4).max(100),
      requested_at: z.iso.datetime({ offset: true }),
      requested_by_me: z.boolean(),
    })
    .nullable(),
});
export type StaffPaymentItem = z.infer<typeof staffPaymentItem>;

/** The staff payments list: delivery status, slots and refunds waiting for approval. */
export function readStaffPaymentList(
  api: FoundationAuthenticatedApi,
  page: number,
  filter?: StaffPaymentListFilter
) {
  return settleStaffCommand(
    api.rpc(
      "get_staff_payment_list",
      { p_page: page, ...(filter ? { p_filter: filter } : {}) },
      { get: false }
    ),
    z.strictObject({
      total: count,
      page: z.literal(page),
      needs_attention: count,
      awaiting_approval: count,
      items: z.array(staffPaymentItem).max(50),
    })
  );
}

/** Refusals of the payment commands that staff can act on, in plain words. */
const PAYMENT_REFUSALS: ReadonlyMap<FoundationErrorReason, [number, string]> = new Map([
  ["ozow_reference_required", [422, "Enter Ozow's refund reference."]],
  [
    "ozow_reference_invalid",
    [422, "Ozow's reference is 4 to 100 letters, digits or . _ : / - with no spaces."],
  ],
  ["refund_reason_code_invalid", [422, "Choose why the money is returned."]],
  ["ozow_reference_used", [409, "That Ozow reference was already recorded for another refund."]],
  ["payment_not_refundable", [409, "This payment or slot was already refunded. Reload the page."]],
  [
    "payment_slot_reversed",
    [409, "A slot of this payment was already refunded. Refund the other slots one by one."],
  ],
  [
    "refund_awaiting_approval",
    [409, "A refund of this payment is waiting for approval. Approve or decline it first."],
  ],
  ["refund_not_waiting", [409, "This refund is no longer waiting for approval. Reload the page."]],
  [
    "refund_approver_same",
    [403, "Another staff member must approve this refund: you recorded it."],
  ],
  ["payment_already_activated", [409, "This payment was already activated. Reload the page."]],
  [
    "payment_not_awaiting_activation",
    [409, "Only a payment that was paid but not delivered can be activated. Reload the page."],
  ],
  [
    "payment_account_unavailable",
    [409, "The account that paid cannot use it now (closed or blocked). Refund it instead."],
  ],
  [
    "addon_target_ineligible",
    [409, "The post can no longer carry this add-on. Refund it instead."],
  ],
  ["payment_slot_exists", [409, "This payment already has a slot. Check it before activating."]],
  [
    "payment_slots_refunded",
    [409, "Every slot of this payment was refunded; there is nothing to activate."],
  ],
  [
    "slot_limit_reached",
    [409, "The person would hold more slots than their limit. Raise the limit or refund."],
  ],
  [
    "staff_review_required",
    [403, "You need an accepted ID review of your own to change payments."],
  ],
  ["staff_same_identity", [403, "Another staff member must handle a payment of your own."]],
]);

async function settlePaymentCommand<T>(
  result: PromiseLike<{
    data: unknown;
    error: { code?: string; message?: string; details?: string } | null;
  }>,
  schema: z.ZodType<T>
): Promise<T> {
  const settled = await result;
  const refusal = lookupDatabaseReason(PAYMENT_REFUSALS, settled.error);
  if (refusal) throw new FoundationStaffCommandError(refusal[0], refusal[1]);
  if (hasDatabaseMessage(settled.error, "staffOwnReviewRequired"))
    throw new FoundationStaffCommandError(
      403,
      "You need an accepted ID review of your own to change payments."
    );
  if (hasDatabaseMessage(settled.error, "staffSameIdentityReversal"))
    throw new FoundationStaffCommandError(
      403,
      "Another staff member must handle a payment of your own."
    );
  return settleStaffCommand(Promise.resolve(settled), schema);
}

const refundResult = z.strictObject({
  request_id: z.uuid(),
  status: z.enum(["applied", "awaiting_approval", "declined"]),
  kind: z.enum(["refunded", "chargeback"]),
  line_id: z.uuid().optional(),
  released_activations: count.nullable(),
  payment_status: z.enum(actualStatuses),
  repeated: z.boolean(),
});

/** Activates what a paid but undelivered payment paid for (audited). */
export function activateStaffPaidPayment(
  api: FoundationAuthenticatedApi,
  paymentId: string,
  reason: string
) {
  return settlePaymentCommand(
    api.rpc(
      "activate_staff_paid_payment",
      { p_payment_id: paymentId, p_reason: staffReason.parse(reason) },
      { get: false }
    ),
    z.strictObject({
      payment_id: z.literal(paymentId),
      fulfillment_status: z.literal("fulfilled"),
      entitlements: count,
      addon_window: z.boolean(),
      commissions: count,
      repeated: z.boolean(),
    })
  );
}

/** Ozow's reference, or a plain refusal: nothing is recorded without it. */
function checkedReference(value: string) {
  if (!value.trim()) throw new FoundationStaffCommandError(422, "Enter Ozow's refund reference.");
  const parsed = ozowReference.safeParse(value);
  if (!parsed.success)
    throw new FoundationStaffCommandError(
      422,
      "Ozow's reference is 4 to 100 letters, digits or . _ : / - with no spaces."
    );
  return parsed.data;
}

export type StaffRefundInput = {
  kind: "refunded" | "chargeback";
  reasonCode: RefundReasonCode;
  reason: string;
  ozowReference: string;
};

/** Records a refund or chargeback of a whole payment with Ozow's reference. */
export async function recordStaffPaymentRefund(
  api: FoundationAuthenticatedApi,
  paymentId: string,
  input: StaffRefundInput
) {
  return settlePaymentCommand(
    api.rpc(
      "record_staff_payment_refund",
      {
        p_payment_id: paymentId,
        p_kind: input.kind,
        p_reason_code: refundReasonCode.parse(input.reasonCode),
        p_reason: staffReason.parse(input.reason),
        p_ozow_reference: checkedReference(input.ozowReference),
      },
      { get: false }
    ),
    refundResult
  );
}

/** Records a refund or chargeback of one slot of an order with Ozow's reference. */
export async function recordStaffSlotRefund(
  api: FoundationAuthenticatedApi,
  lineId: string,
  input: StaffRefundInput
) {
  return settlePaymentCommand(
    api.rpc(
      "record_staff_slot_refund",
      {
        p_line_id: lineId,
        p_kind: input.kind,
        p_reason_code: refundReasonCode.parse(input.reasonCode),
        p_reason: staffReason.parse(input.reason),
        p_ozow_reference: checkedReference(input.ozowReference),
      },
      { get: false }
    ),
    refundResult
  );
}

/** A second, different staff member approves a refund above R1,000. */
export function approveStaffPaymentRefund(api: FoundationAuthenticatedApi, requestId: string) {
  return settlePaymentCommand(
    api.rpc("approve_staff_payment_refund", { p_request_id: requestId }, { get: false }),
    refundResult.omit({ line_id: true })
  );
}

/** Declines (or, for its requester, withdraws) a refund waiting for approval. */
export function declineStaffPaymentRefund(
  api: FoundationAuthenticatedApi,
  requestId: string,
  reason: string
) {
  return settlePaymentCommand(
    api.rpc(
      "decline_staff_payment_refund",
      { p_request_id: requestId, p_reason: staffReason.parse(reason) },
      { get: false }
    ),
    z.strictObject({
      request_id: z.literal(requestId),
      status: z.literal("declined"),
      repeated: z.boolean(),
    })
  );
}
