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
  // From <ts>_refund_follow_ups.sql (plan B, approved 18 Nov 2026): a renewal
  // refunded before its days started. Read here before that update is
  // applied; staff are not offered it until the update is live (the current
  // database refuses it with refund_reason_code_invalid).
  "renewal_cancelled_before_start",
  // From 20261125133916_staff_part_refunds.sql: a first purchase cancelled
  // within 5 business days, refunded in full (api.record_staff_refund only).
  "first_purchase_cancelled",
] as const;
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];
export const refundReasonCode = z.enum(REFUND_REASON_CODES);

/** A refund (or chargeback) reference: Ozow's, or for a bank-transfer payment
 * the bank's, which may hold single spaces. The database applies the rule of
 * the payment's method (Ozow references never have spaces). */
const refundReference = z
  .string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,99}$/));

const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const staffPaymentItem = z.strictObject({
  id: z.uuid(),
  // Null once the paying account was erased: the payment is kept, unlinked.
  user_id: z.uuid().nullable(),
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

/**
 * Refusals of the refund follow-ups update (plan B), shared by the refund
 * through Ozow (./ozow-refunds.ts) and the refunds recorded with a reference:
 * a slot whose renewal is waiting is refunded renewal first, the "cancelled
 * before the renewal started" reason fits only a renewal yet to start, and
 * Ozow refunds only within its window.
 */
export const STAFF_REFUND_FOLLOW_UP_REFUSALS: ReadonlyArray<
  [FoundationErrorReason, [number, string]]
> = [
  [
    "renewal_queued",
    [409, "This slot has a renewal waiting. Refund the renewal first, then this period."],
  ],
  [
    "renewal_already_started",
    [
      409,
      "'Cancelled before the renewal started' is only for a renewal whose days have not started. Choose another reason.",
    ],
  ],
  [
    "outside_refund_window",
    [
      409,
      "Ozow refunds are possible only up to 13 days after the payment. Pay it back by bank transfer and record the bank reference instead.",
    ],
  ],
];

/**
 * Refusals of the first-purchase and part refunds
 * (20261125133916_staff_part_refunds.sql, api.record_staff_refund), shared by
 * the refunds through Ozow (./ozow-refunds.ts) and the refunds recorded with
 * a reference.
 */
export const STAFF_PART_REFUND_REFUSALS: ReadonlyArray<[FoundationErrorReason, [number, string]]> =
  [
    [
      "refund_more_than_left",
      [409, "That is more than is left to refund on this payment or slot. Reload the page."],
    ],
    ["refund_amount_invalid", [422, "Enter an amount of at least 1 cent."]],
    [
      "refund_whole_only",
      [
        409,
        "This reason refunds everything left. Leave the amount as it is, or choose another reason.",
      ],
    ],
    [
      "refund_asked_on_unexpected",
      [422, "The date the customer asked is only for a first purchase cancelled."],
    ],
    [
      "first_purchase_not_first",
      [409, "This is not the account's first purchase. Choose another reason."],
    ],
    [
      "first_purchase_whole_payment",
      [
        409,
        "A first purchase is refunded in full: the whole payment, with nothing refunded before.",
      ],
    ],
    [
      "first_purchase_asked_on_required",
      [422, "Enter the date the customer asked in writing to cancel."],
    ],
    [
      "first_purchase_asked_on_invalid",
      [422, "The date the customer asked is between the day the payment was confirmed and today."],
    ],
    [
      "first_purchase_too_late",
      [
        409,
        "The customer asked after the 5 business days for cancelling a first purchase. Choose another reason if one applies.",
      ],
    ],
    [
      "first_purchase_account_erased",
      [409, "The account that paid was erased, so its first purchase cannot be checked."],
    ],
    ["ozow_refund_id_required", [422, "Enter Ozow's refund id from the Ozow dashboard."]],
    [
      "ozow_refund_id_used",
      [409, "That Ozow refund was already recorded. Reload the page to see it."],
    ],
    [
      "payment_not_ozow",
      [409, "This payment was not paid through Ozow. Record its refund with its reference."],
    ],
    [
      "refund_in_flight",
      [409, "A refund of this payment is on its way through Ozow. Wait for Ozow's answer."],
    ],
    [
      "ozow_refund_mismatch",
      [
        409,
        "This Ozow refund is for another payment or amount. Check the refund id and the amount in the Ozow dashboard.",
      ],
    ],
    ["refund_ozow_failed", [409, "Ozow has no paid refund with this id. Do not record it."]],
    [
      "refund_request_reused",
      [409, "This refund was already recorded with other details. Reload the page to see it."],
    ],
    ["refund_request_id_required", [422, "Reload the page and record the refund again."]],
    [
      "refund_activate_first",
      [
        409,
        "This payment is not activated yet. Use 'Activate what was paid for' first, then refund part of it.",
      ],
    ],
  ];

/** Refusals of the payment commands that staff can act on, in plain words. */
const PAYMENT_REFUSALS: ReadonlyMap<FoundationErrorReason, [number, string]> = new Map([
  ["ozow_reference_required", [422, "Enter Ozow's refund reference."]],
  [
    "ozow_reference_invalid",
    [422, "Ozow's reference is 4 to 100 letters, digits or . _ : / - with no spaces."],
  ],
  ["refund_reason_code_invalid", [422, "Choose why the money is returned."]],
  ["ozow_reference_used", [409, "That Ozow reference was already recorded for another refund."]],
  [
    "ozow_reference_retired",
    [
      409,
      "Refunds of Ozow payments now go through Ozow. Use 'Refund through Ozow', or 'Recorded in the Ozow dashboard' with Ozow's refund id.",
    ],
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
  ["refund_not_waiting", [409, "This refund is no longer waiting for approval. Reload the page."]],
  [
    "refund_payment_changed",
    [409, "The payment changed since this refund was recorded. Decline it and record it again."],
  ],
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
    [403, "You need a current accepted ID review of your own to change payments."],
  ],
  ["staff_same_identity", [403, "Another staff member must handle a payment of your own."]],
  [
    "invoice_payment_invalid",
    [422, "Enter the customer's email, the slot term, the number of slots and the amount."],
  ],
  [
    "invoice_amount_above_limit",
    [422, "Bank transfers above R50 000 cannot be recorded yet. Nothing was recorded."],
  ],
  ["bank_reference_required", [422, "Enter the bank reference from the bank statement."]],
  [
    "bank_reference_invalid",
    [422, "The bank reference is 4 to 60 letters, digits, spaces or . _ : / -."],
  ],
  [
    "cleared_date_invalid",
    [
      422,
      "Enter the date the money cleared: today or in the last 90 days, or an earlier date only to record again the money of an expired transfer (same reference, amount and date).",
    ],
  ],
  [
    "cooling_off_waiver_required",
    [422, "Confirm the customer agreed in writing to the cooling-off waiver."],
  ],
  ["invoice_account_unavailable", [404, "No confirmed account has that email."]],
  [
    "staff_referred_customer",
    [403, "Another staff member must handle a payment of a customer you or its recorder referred."],
  ],
  [
    "bank_reference_used",
    [
      409,
      "A bank transfer with that reference, amount and date is already waiting or confirmed. Check the payments list before recording it.",
    ],
  ],
  ["refund_reference_required", [422, "Enter the bank reference of the transfer back."]],
  [
    "refund_reference_invalid",
    [422, "The bank reference is 4 to 100 letters, digits, spaces or . _ : / -."],
  ],
  ["refund_reference_used", [409, "That bank reference was already recorded for another refund."]],
  ["invoice_plan_unavailable", [409, "No slot for that term is on sale now."]],
  [
    "invoice_buyer_unverified",
    [409, "The customer's ID review must be accepted before their slots are recorded."],
  ],
  [
    "transfer_confirmer_same",
    [403, "Another staff member must confirm this bank transfer: you recorded it."],
  ],
  [
    "transfer_recorder_inactive",
    [
      409,
      "The staff member who recorded this transfer can no longer record payments. Decline it and record it again.",
    ],
  ],
  [
    "transfer_not_waiting",
    [
      409,
      "This bank transfer is no longer waiting for confirmation: it was confirmed or declined, or nobody confirmed it within 14 days and it expired. Reload the page.",
    ],
  ],
  ["transfer_resolved", [409, "This expired bank transfer was already resolved. Reload the page."]],
  [
    "transfer_resolver_same",
    [403, "Another staff member must resolve this bank transfer: you recorded it."],
  ],
  [
    "transfer_not_expired",
    [409, "Only an expired bank transfer is resolved here. Confirm or decline a waiting one."],
  ],
  [
    "invoice_amount_mismatch",
    [422, "The amount received is not the order total. Check the term and the number of slots."],
  ],
  // Customer invoices (update 20261114041000).
  [
    "invoice_transfer_required",
    [
      409,
      "This customer has an unpaid invoice for this amount. Record the transfer on that invoice (Invoices), so it pays the invoice.",
    ],
  ],
  [
    "invoice_paid_elsewhere",
    [
      409,
      "Another payment already paid this invoice, or it was voided. Refund this payment instead.",
    ],
  ],
  [
    "invoice_paid",
    [409, "This invoice was already paid. Decline this transfer and return the money."],
  ],
  ["invoice_void", [409, "This invoice was voided. Decline this transfer and return the money."]],
  // Multi-listing package invoices (update 20261119025106).
  [
    "invoice_checkout_open",
    [
      409,
      "The customer has another package payment open at Ozow. Try again when it has closed (paid, cancelled or expired).",
    ],
  ],
  [
    "packages_not_on_sale",
    [409, "Multi-listing packages are not on sale. Decline this transfer and return the money."],
  ],
  [
    "package_active",
    [
      409,
      "The customer's Multi-listing package stops this: no Individual slot is sold while it runs, and no second package starts. Decline this transfer and return the money.",
    ],
  ],
  [
    "invoice_payment_open",
    [409, "A payment of this invoice is still open at Ozow. Try again when it has closed."],
  ],
  // Refund follow-ups (<ts>_refund_follow_ups.sql, not applied yet).
  ...STAFF_REFUND_FOLLOW_UP_REFUSALS,
  // First-purchase and part refunds (20261125133916_staff_part_refunds.sql).
  ...STAFF_PART_REFUND_REFUSALS,
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
  // An approved refund through Ozow is "approved" (then sent and settled by
  // the server: ./ozow-refunds.ts); the other states are the same as before.
  status: z.enum([
    "applied",
    "awaiting_approval",
    "declined",
    "approved",
    "sent",
    "failed",
    "returned",
  ]),
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

/** The refund reference, or a plain refusal: nothing is recorded without it. */
function checkedReference(value: string) {
  if (!value.trim()) throw new FoundationStaffCommandError(422, "Enter the refund reference.");
  const parsed = refundReference.safeParse(value);
  if (!parsed.success)
    throw new FoundationStaffCommandError(
      422,
      "The reference is 4 to 100 letters, digits, spaces or . _ : / -."
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

/** How the money of a refund recorded with api.record_staff_refund goes back. */
export type StaffRefundChannel = "ozow" | "dashboard" | "reference";

export type StaffPartRefundInput = {
  paymentId: string;
  /** One slot of the payment, or null for the whole payment. */
  lineId: string | null;
  channel: StaffRefundChannel;
  /** Part of what is left, in cents; null refunds everything left. */
  amountCents: number | null;
  reasonCode: RefundReasonCode;
  reason: string;
  /** The bank or Ozow reference ("reference"), Ozow's refund id ("dashboard"). */
  reference: string | null;
  /** The refund as the server read it from Ozow ("dashboard", when it could). */
  ozowFact: {
    refund_id: string;
    transaction_id: string;
    amount_cents: number;
    status: string;
    requested_at: string | null;
    completed_at: string | null;
  } | null;
  /** The day the customer asked in writing (first purchase only), YYYY-MM-DD. */
  askedOn: string | null;
  /** One id per refund form opening, sent again on a retry: the same request
   * returns the first record instead of refunding twice. */
  requestId: string;
};

const partRefundResult = z.strictObject({
  request_id: z.uuid(),
  status: z.enum([
    "applied",
    "awaiting_approval",
    "approved",
    "sent",
    "failed",
    "returned",
    "declined",
  ]),
  channel: z.enum(["api", "dashboard", "manual"]),
  kind: z.literal("refunded"),
  line_id: z.uuid().nullable(),
  amount_cents: cents,
  needs_approval: z.boolean(),
  ends_paid_days: z.boolean(),
  released_activations: count.nullable(),
  payment_status: z.enum(actualStatuses),
  repeated: z.boolean(),
});
const isoDay = z.iso.date();

/**
 * A refund of a payment or slot through Ozow, from the Ozow dashboard or with
 * a reference, for everything left or a part of it, and the first-purchase
 * refund (api.record_staff_refund, 20261125133916_staff_part_refunds.sql). The
 * database decides what is left, whether the slot keeps running, the
 * first-purchase rules and the second approver above R1 000.
 */
export function recordStaffRefund(api: FoundationAuthenticatedApi, input: StaffPartRefundInput) {
  if (
    input.amountCents !== null &&
    !(Number.isSafeInteger(input.amountCents) && input.amountCents > 0)
  )
    throw new FoundationStaffCommandError(422, "Enter an amount of at least 1 cent.");
  if (input.askedOn !== null && !isoDay.safeParse(input.askedOn).success)
    throw new FoundationStaffCommandError(
      422,
      "Enter the date the customer asked in writing to cancel."
    );
  const reference =
    input.channel === "reference" ? checkedReference(input.reference ?? "") : input.reference;
  return settlePaymentCommand(
    api.rpc(
      "record_staff_refund",
      {
        p_payment_id: input.paymentId,
        p_line_id: input.lineId,
        p_channel: input.channel,
        p_amount_cents: input.amountCents,
        p_reason_code: refundReasonCode.parse(input.reasonCode),
        p_reason: staffReason.parse(input.reason),
        p_reference: reference,
        p_ozow_fact: input.ozowFact,
        p_asked_on: input.askedOn,
        p_request_id: input.requestId,
      },
      { get: false }
    ),
    partRefundResult
  );
}

const refundsLeftItem = z.strictObject({
  payment_id: z.uuid(),
  refunded_cents: count,
  left_cents: count,
  ozow_refund_until: z.iso.datetime({ offset: true }).nullable(),
  first_purchase: z.boolean(),
  first_purchase_ask_until: isoDay.nullable(),
  // Optional: added by 20261125194727_part_refund_follow_ups.sql (the website
  // is deployed before it is applied).
  notice_ends_on: isoDay.optional(),
  lines: z
    .array(
      z.strictObject({
        line_id: z.uuid(),
        left_cents: count,
        starts_at: z.iso.datetime({ offset: true }).nullable(),
        ends_at: z.iso.datetime({ offset: true }).nullable(),
        paid_days: z.number().int().min(1).max(366).nullable().optional(),
        lost_days: count.optional(),
      })
    )
    .max(25),
});
export type StaffRefundsLeft = z.infer<typeof refundsLeftItem>;

/**
 * For up to 50 payments of the staff list: what was refunded and what is left
 * (per payment and per slot), each slot's paid dates, until when Ozow refunds
 * it, and whether it is the account's first purchase with the last day to ask;
 * once 20261125194727_part_refund_follow_ups.sql is applied, also the end of
 * 20 business days' notice given today and each slot's plan term and lost days.
 */
export function readStaffRefundsLeft(api: FoundationAuthenticatedApi, paymentIds: string[]) {
  return settleStaffCommand(
    api.rpc("get_staff_refunds_left", { p_payment_ids: paymentIds }, { get: false }),
    z.array(refundsLeftItem).max(50)
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

/** The slot terms a bank transfer can pay for (the Individual slots on sale). */
export const BANK_TRANSFER_TERMS = [30, 90, 180] as const;
export type BankTransferTerm = (typeof BANK_TRANSFER_TERMS)[number];
/** Bank transfers for Individual slots without an invoice above R50 000 are
 * refused. The database decides. */
const BANK_TRANSFER_LIMIT_CENTS = 5_000_000;
/** A recorded transfer to a Multi-listing package invoice can be up to 250
 * slots for 180 days (R150 000, update 20261119025106). */
const RECORDED_TRANSFER_LIMIT_CENTS = 15_000_000;

/** A bank reference as the database stores it: spaces collapsed, 4 to 60
 * letters, digits, spaces or . _ : / -, with at least four letters or digits. */
export function normaliseBankReference(value: string): string | null {
  const reference = value.trim().replace(/\s+/g, " ");
  return /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{3,59}$/.test(reference) &&
    reference.replace(/[^A-Za-z0-9]/g, "").length >= 4
    ? reference
    : null;
}

export type StaffBankTransferInput = {
  accountEmail: string;
  termDays: BankTransferTerm;
  slots: number;
  amountCents: number;
  bankReference: string;
  /** The date the money cleared, YYYY-MM-DD (South African date). */
  clearedOn: string;
  /** The customer agreed in writing that their slots start now (no cooling-off). */
  coolingOffWaiver: boolean;
  reason: string;
};

const term = z.union([z.literal(30), z.literal(90), z.literal(180)]);
/** A recorded bank transfer as staff see it (waiting, confirmed or declined). */
const staffTransferRecord = z.strictObject({
  transfer_id: z.uuid(),
  status: z.enum(["awaiting_confirmation", "confirmed", "declined"]),
  // Null once the account was erased (the record is kept, unlinked).
  account_id: z.uuid().nullable(),
  customer_email: z.string().max(254).nullable(),
  similar_records: count,
  customer_name: z.string().max(120).nullable(),
  term_days: term,
  // Individual slots 1 to 25; a Multi-listing package invoice 5 to 250.
  slots: z.number().int().min(1).max(250),
  amount_received_cents: cents.max(RECORDED_TRANSFER_LIMIT_CENTS),
  bank_reference: z.string().min(4).max(60),
  cleared_on: z.iso.date(),
  reason: z.string().min(5).max(500),
  recorded_at: z.iso.datetime({ offset: true }),
  recorded_by_me: z.boolean(),
  recorded_by_name: z.string().max(120).nullable(),
  payment_id: z.uuid().nullable(),
});

/** Records a cleared bank transfer. It waits for a second staff member: no
 * slot starts and nothing is sent until another person confirms it (audited). */
export async function recordStaffBankTransfer(
  api: FoundationAuthenticatedApi,
  input: StaffBankTransferInput
) {
  if (!input.bankReference.trim())
    throw new FoundationStaffCommandError(422, "Enter the bank reference from the bank statement.");
  const reference = normaliseBankReference(input.bankReference);
  if (!reference)
    throw new FoundationStaffCommandError(
      422,
      "The bank reference is 4 to 60 letters, digits, spaces or . _ : / -."
    );
  if (input.coolingOffWaiver !== true)
    throw new FoundationStaffCommandError(
      422,
      "Confirm the customer agreed in writing to the cooling-off waiver."
    );
  if (input.amountCents > BANK_TRANSFER_LIMIT_CENTS)
    throw new FoundationStaffCommandError(
      422,
      "Bank transfers above R50 000 cannot be recorded yet. Nothing was recorded."
    );
  return settlePaymentCommand(
    api.rpc(
      "record_staff_invoice_payment",
      {
        p_account_email: input.accountEmail.trim(),
        p_term_days: input.termDays,
        p_slots: input.slots,
        p_amount_cents: input.amountCents,
        p_bank_reference: reference,
        p_cleared_on: input.clearedOn,
        p_cooling_off_waiver: true,
        p_reason: staffReason.parse(input.reason),
      },
      { get: false }
    ),
    staffTransferRecord.extend({ repeated: z.boolean() })
  );
}

/** A second staff member confirms a recorded transfer: only now the slots
 * start, the receipt is sent and the partner commission is created. */
export function confirmStaffBankTransfer(api: FoundationAuthenticatedApi, transferId: string) {
  return settlePaymentCommand(
    api.rpc("confirm_staff_invoice_payment", { p_transfer_id: transferId }, { get: false }),
    staffTransferRecord.extend({
      transfer_id: z.literal(transferId),
      status: z.literal("confirmed"),
      payment_id: z.uuid(),
      commissions: count,
      slots_started: z.number().int().min(1).max(250).optional(),
      ends_at: z.iso.datetime({ offset: true }).optional(),
      repeated: z.boolean(),
    })
  );
}

/** Declines (or, for its recorder, withdraws) a waiting record. The bank
 * reference stays used. */
export function declineStaffBankTransfer(
  api: FoundationAuthenticatedApi,
  transferId: string,
  reason: string
) {
  return settlePaymentCommand(
    api.rpc(
      "decline_staff_invoice_payment",
      { p_transfer_id: transferId, p_reason: staffReason.parse(reason) },
      { get: false }
    ),
    staffTransferRecord.extend({
      transfer_id: z.literal(transferId),
      status: z.literal("declined"),
      repeated: z.boolean(),
    })
  );
}

/** The recorded bank transfers waiting for a second staff member (oldest first). */
export function readStaffBankTransfersWaiting(api: FoundationAuthenticatedApi) {
  return settleStaffCommand(
    api.rpc("get_staff_invoice_transfers", {}, { get: false }),
    z.strictObject({
      waiting: count,
      items: z
        .array(staffTransferRecord.extend({ status: z.literal("awaiting_confirmation") }))
        .max(50),
    })
  );
}

const staffExpiredTransfer = staffTransferRecord.extend({
  status: z.literal("expired"),
  expired_at: z.iso.datetime({ offset: true }),
  /** The invoice the transfer was recorded to, if any. */
  invoice_number: z
    .string()
    .regex(/^VM-\d{4}-\d{6}$/)
    .nullable(),
});
export type StaffExpiredTransfer = z.infer<typeof staffExpiredTransfer>;

/** The recorded bank transfers nobody confirmed within 14 days of being
 * recorded (20261118044440_bank_transfer_expiry.sql) that still need a
 * follow-up: not recorded again and not naming an invoice since paid or
 * voided. Oldest first, at most 200, with the full count. Against a database
 * without that update there are none. */
export async function readStaffBankTransfersExpired(
  api: FoundationAuthenticatedApi
): Promise<{ unresolved: number; items: StaffExpiredTransfer[] }> {
  const result = await api.rpc("get_staff_expired_invoice_transfers", {}, { get: false });
  if (result.error?.code === "PGRST202" || result.error?.code === "42883")
    return { unresolved: 0, items: [] };
  return settleStaffCommand(
    Promise.resolve(result),
    z.strictObject({ unresolved: count, items: z.array(staffExpiredTransfer).max(200) })
  );
}

/** How staff followed up an expired transfer that will not be recorded again. */
export const EXPIRED_TRANSFER_RESOLUTIONS = ["returned", "never_arrived"] as const;
export type ExpiredTransferResolution = (typeof EXPIRED_TRANSFER_RESOLUTIONS)[number];

/** Records once (audited, with a reason) that the money of an expired
 * transfer was returned outside VerifyMzansi or never arrived; it then leaves
 * the follow-up list. Nothing is paid or started. */
export function resolveStaffExpiredTransfer(
  api: FoundationAuthenticatedApi,
  transferId: string,
  resolution: ExpiredTransferResolution,
  reason: string
) {
  return settlePaymentCommand(
    api.rpc(
      "resolve_expired_invoice_transfer",
      {
        p_transfer_id: transferId,
        p_resolution: z.enum(EXPIRED_TRANSFER_RESOLUTIONS).parse(resolution),
        p_reason: staffReason.parse(reason),
      },
      { get: false }
    ),
    staffTransferRecord.extend({
      transfer_id: z.literal(transferId),
      status: z.literal("expired"),
      resolution: z.literal(resolution),
      repeated: z.boolean(),
    })
  );
}

/** Whose account an email names, before staff record a bank transfer for it. */
export function readStaffBankTransferCustomer(api: FoundationAuthenticatedApi, email: string) {
  return settlePaymentCommand(
    api.rpc("get_staff_invoice_customer", { p_account_email: email.trim() }, { get: false }),
    z.strictObject({
      customer_name: z.string().max(120).nullable(),
      id_reviewed: z.boolean(),
      can_use_slots: z.boolean(),
      slots_held: count.nullable(),
      slot_limit: z.number().int().min(1).max(25).nullable(),
    })
  );
}

const staffBankTransfer = z.strictObject({
  payment_id: z.uuid(),
  bank_reference: z.string().min(4).max(60),
  cleared_on: z.iso.date(),
  amount_received_cents: cents,
  recorded_at: z.iso.datetime({ offset: true }),
  recorded_by_me: z.boolean(),
  confirmed_by_me: z.boolean(),
  reason: z.string().min(5).max(500),
});
export type StaffBankTransfer = z.infer<typeof staffBankTransfer>;

/** The bank transfer details of the listed payments (those paid by bank transfer). */
export async function readStaffBankTransfers(
  api: FoundationAuthenticatedApi,
  paymentIds: readonly string[]
): Promise<StaffBankTransfer[]> {
  const ids = z
    .array(z.uuid())
    .max(50)
    .parse([...new Set(paymentIds)]);
  if (ids.length === 0) return [];
  const result = await settleStaffCommand(
    api.rpc("get_staff_invoice_payments", { p_payment_ids: ids }, { get: false }),
    z.strictObject({ items: z.array(staffBankTransfer).max(50) })
  );
  const asked = new Set(ids);
  return result.items.filter((item) => asked.has(item.payment_id));
}
