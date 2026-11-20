import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { lookupDatabaseReason, type FoundationErrorReason } from "./error-reasons";
import { staffReason } from "./organisations";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";
import {
  FoundationInvoiceError,
  settleInvoiceMemberCommand,
  staffInvoiceSchema,
  type InvoiceMemberWording,
  type RpcResult,
} from "./customer-invoices";
import { BILLING_EMAIL } from "../billing/slot-checkout";
import {
  PACKAGE_ADD_MIN_INVOICE_DAYS,
  PACKAGE_MAX_SLOTS,
  PACKAGE_MIN_SLOTS,
} from "../billing/slot-packages";

/**
 * Multi-listing package invoices (roadmap P4e, update 20261119025106): a member
 * asks for an invoice for a package ("Ask for an invoice"); staff issue it (a
 * second staff member approves one above R50,000) or decline the request. The
 * database owns the price, the total, the number, every rule and every
 * refusal; these adapters only check the shape of its answers and put its
 * refusals in plain words. The invoice itself is a customer invoice
 * (./customer-invoices.ts), paid with Pay now or by bank transfer.
 */

const instant = z.iso.datetime({ offset: true });
const term = z.union([z.literal(30), z.literal(90), z.literal(180)]);
/** A package total: at most 250 slots for 180 days (R150 000). */
const cents = z.number().int().positive().max(15_000_000);
const INVOICE_NUMBER = /^VM-\d{4}-\d{6}$/;

const requestFields = {
  request_id: z.uuid(),
  status: z.enum(["requested", "awaiting_approval", "issued", "declined", "withdrawn"]),
  term_days: term,
  unit_price_cents: cents,
  total_cents: cents,
  requested_at: instant,
  invoice_number: z.string().regex(INVOICE_NUMBER).nullable(),
  closed_at: instant.nullable(),
};
/** Slots added to the member's running package (P4b, update 20261120120000):
 * 1 or more, priced for the whole days left (`days_left`), ending with the
 * package (`package_ends_at`, null once it has no running slot). */
const addFields = {
  slots: z.number().int().min(1).max(PACKAGE_MAX_SLOTS),
  kind: z.literal("add"),
  days_left: z.number().int().min(10).max(179),
  package_ends_at: instant.nullable(),
};
const packageSlots = z.number().int().min(PACKAGE_MIN_SLOTS).max(PACKAGE_MAX_SLOTS);
/** A request for a new package (5 to 250 slots) or an add, with `extra`
 * fields (which replace the request's own of the same name). */
function requestSchema<T extends z.ZodRawShape, E extends z.ZodRawShape>(base: T, extra: E) {
  return z.union([
    z.strictObject({ ...base, slots: packageSlots, ...extra }),
    z.strictObject({ ...base, ...addFields, ...extra }),
  ]);
}
const packageInvoiceRequestSchema = requestSchema(requestFields, {});
export type PackageInvoiceRequest = z.infer<typeof packageInvoiceRequestSchema>;

const staffRequestFields = {
  // Null once the account was erased (the request is kept, unlinked).
  account_id: z.uuid().nullable(),
  customer_email: z.string().max(254).nullable(),
  customer_name: z.string().max(120).nullable(),
  identity_accepted: z.boolean(),
  package_open: z.boolean(),
  needs_approval: z.boolean(),
  due_days: z.number().int().min(1).max(30).nullable(),
  staff_reason: z.string().min(5).max(500).nullable(),
  prepared_at: instant.nullable(),
  prepared_by_me: z.boolean(),
  prepared_by_name: z.string().max(120).nullable(),
  close_reason: z.string().min(5).max(500).nullable(),
};
const staffBase = { ...requestFields, ...staffRequestFields };
const staffPackageInvoiceRequestSchema = requestSchema(staffBase, {});
export type StaffPackageInvoiceRequest = z.infer<typeof staffPackageInvoiceRequestSchema>;

// ---------------------------------------------------------------- member

const MEMBER_REFUSALS: ReadonlyMap<
  FoundationErrorReason,
  readonly [FoundationInvoiceError["status"], string]
> = new Map([
  ["packages_not_on_sale", [403, "Multi-listing packages are not on sale yet."]],
  [
    "package_slots_invalid",
    [422, `A package has ${PACKAGE_MIN_SLOTS} to ${PACKAGE_MAX_SLOTS} slots.`],
  ],
  [
    "invoice_consent_required",
    [422, "Tick the box to confirm that your slots start as soon as the invoice is paid."],
  ],
  [
    "package_active",
    [409, "This account already has a Multi-listing package. Its slots are on My slots."],
  ],
  [
    "package_invoice_unpaid",
    [
      409,
      `Your package invoice is not paid yet. Pay it from Invoices, or email ${BILLING_EMAIL} to cancel it first.`,
    ],
  ],
  [
    "package_invoice_request_open",
    [409, `We are preparing your invoice. Email ${BILLING_EMAIL} to change it.`],
  ],
  ["invoice_request_conflict", [409, "Reload the page and try again."]],
  [
    "package_invoice_requests_limit",
    [429, `You have asked for many invoices today. Try again tomorrow, or email ${BILLING_EMAIL}.`],
  ],
]);

const MEMBER_WORDING: InvoiceMemberWording = {
  reasons: MEMBER_REFUSALS,
  codes: {
    PT412: [
      403,
      "Your ID review must be accepted before you ask for a package invoice, so you never pay for days you cannot use.",
    ],
    PT428: [409, "The price changed. Check the total and try again."],
  },
  unavailable: "Your request could not be sent. Please try again in a few minutes.",
};

/** An add's refusals (P4b): its own words where they differ. */
const ADD_WORDING: InvoiceMemberWording = {
  ...MEMBER_WORDING,
  reasons: new Map([
    ...MEMBER_REFUSALS,
    [
      "package_slots_invalid",
      [422, `A package holds at most ${PACKAGE_MAX_SLOTS} slots. Add fewer slots.`],
    ],
    [
      "package_ended",
      [409, "Your package has ended, so slots cannot be added to it. Its slots are on My slots."],
    ],
    [
      "package_add_invoice_too_late",
      [
        409,
        `Slots are added by invoice while ${PACKAGE_ADD_MIN_INVOICE_DAYS} or more days of your package are left.`,
      ],
    ],
    ["invoice_plan_unavailable", [409, "Slots cannot be added to this package now."]],
  ]),
};

function settleMemberCommand<T>(result: RpcResult, schema: z.ZodType<T>): Promise<T> {
  return settleInvoiceMemberCommand(result, schema, MEMBER_WORDING);
}

export const packageInvoiceRequestInput = z.strictObject({
  planId: z.uuid(),
  slots: z.number().int().min(PACKAGE_MIN_SLOTS).max(PACKAGE_MAX_SLOTS),
  expectedTotalCents: cents,
  coolingOffConsent: z.boolean(),
  requestId: z.uuid(),
});
export type PackageInvoiceRequestInput = z.infer<typeof packageInvoiceRequestInput>;

/**
 * "Ask for an invoice": the member's request for a package invoice. The box
 * must be ticked (paid by bank transfer, the slots start without the 7-day
 * cooling-off); the database records it in the invoice's own words.
 */
export async function requestPackageInvoice(
  api: FoundationAuthenticatedApi,
  input: PackageInvoiceRequestInput
) {
  const value = packageInvoiceRequestInput.parse(input);
  if (value.coolingOffConsent !== true)
    throw new FoundationInvoiceError(
      422,
      "Tick the box to confirm that your slots start as soon as the invoice is paid.",
      "invoice_refused"
    );
  return settleMemberCommand(
    api.rpc(
      "request_package_invoice",
      {
        p_plan_id: value.planId,
        p_slots: value.slots,
        p_expected_total_cents: value.expectedTotalCents,
        p_cooling_off_consent: true,
        p_request_id: value.requestId,
      },
      { get: false }
    ),
    requestSchema(requestFields, { repeated: z.boolean() })
  );
}

export const packageAddInvoiceRequestInput = z.strictObject({
  packageId: z.uuid(),
  slots: z.number().int().min(1).max(PACKAGE_MAX_SLOTS),
  expectedTotalCents: cents,
  coolingOffConsent: z.boolean(),
  requestId: z.uuid(),
});
export type PackageAddInvoiceRequestInput = z.infer<typeof packageAddInvoiceRequestInput>;

/**
 * "Ask for an invoice" for slots added to the member's running package (P4b,
 * D1): only while 10 or more days are left; the price of this moment is kept
 * on the invoice. The database prices and checks every rule again.
 */
export async function requestPackageAddInvoice(
  api: FoundationAuthenticatedApi,
  input: PackageAddInvoiceRequestInput
) {
  const value = packageAddInvoiceRequestInput.parse(input);
  if (value.coolingOffConsent !== true)
    throw new FoundationInvoiceError(
      422,
      "Tick the box to confirm that your slots start as soon as the invoice is paid.",
      "invoice_refused"
    );
  return settleInvoiceMemberCommand(
    api.rpc(
      "request_package_add_invoice",
      {
        p_package_id: value.packageId,
        p_slots: value.slots,
        p_expected_total_cents: value.expectedTotalCents,
        p_cooling_off_consent: true,
        p_request_id: value.requestId,
      },
      { get: false }
    ),
    z.strictObject({ ...requestFields, ...addFields, repeated: z.boolean() }),
    ADD_WORDING
  );
}

/** The member's latest package invoice request, or null. */
export async function readMyPackageInvoiceRequest(api: FoundationAuthenticatedApi) {
  return (
    await settleMemberCommand(
      api.rpc("get_my_package_invoice_request", {}, { get: false }),
      z.strictObject({ request: packageInvoiceRequestSchema.nullable() })
    )
  ).request;
}

// ---------------------------------------------------------------- staff

const STAFF_REFUSALS: ReadonlyMap<FoundationErrorReason, [number, string]> = new Map([
  ["package_invoice_request_unavailable", [404, "No such invoice request. Reload the page."]],
  [
    "package_invoice_request_closed",
    [409, "This request was already handled or withdrawn. Reload the page."],
  ],
  ["invoice_issue_invalid", [422, "Days to pay: 1 to 30."]],
  ["packages_not_on_sale", [409, "Multi-listing packages are not on sale."]],
  [
    "invoice_plan_unavailable",
    [409, "This package term is no longer sold at the price asked for. Decline the request."],
  ],
  [
    "package_active",
    [409, "The customer already has a Multi-listing package. Decline the request."],
  ],
  [
    "package_invoice_unpaid",
    [409, "The customer has an unpaid package invoice. Void it first, or decline this request."],
  ],
  // Added slots (P4b): only while the package runs with 7 or more days left and room.
  ["package_ended", [409, "The customer's package has ended. Decline the request."]],
  [
    "package_add_too_late",
    [409, "Fewer than 7 days of the customer's package are left. Decline the request."],
  ],
  [
    "package_slots_invalid",
    [409, `The package would hold more than ${PACKAGE_MAX_SLOTS} slots. Decline the request.`],
  ],
  [
    "invoice_checkout_open",
    [
      409,
      "The customer has a package payment open at Ozow. Try again when it has closed (paid, cancelled or expired).",
    ],
  ],
  [
    "payment_account_unavailable",
    [409, "The customer's account cannot use slots now (closed or blocked)."],
  ],
  [
    "invoice_buyer_unverified",
    [409, "The customer's ID review must be accepted before an invoice is issued."],
  ],
  [
    "invoice_vat_status_changed",
    [409, "The VAT registration setting changed. Invoices need updating before one is issued."],
  ],
  [
    "invoice_approver_same",
    [403, "Another staff member must approve this invoice: you prepared it."],
  ],
  [
    "invoice_preparer_inactive",
    [
      409,
      "The staff member who prepared this invoice can no longer issue invoices. Decline the request.",
    ],
  ],
  [
    "staff_review_required",
    [403, "You need a current accepted ID review of your own to issue invoices."],
  ],
  ["staff_same_identity", [403, "Another staff member must invoice your own account."]],
  ["staff_referred_customer", [403, "Another staff member must invoice a customer you referred."]],
]);

async function settlePackageStaffCommand<T>(result: RpcResult, schema: z.ZodType<T>): Promise<T> {
  const settled = await result;
  const refusal = lookupDatabaseReason(STAFF_REFUSALS, settled.error);
  if (refusal) throw new FoundationStaffCommandError(refusal[0], refusal[1]);
  return settleStaffCommand(Promise.resolve(settled), schema);
}

/** The open package invoice requests, oldest first (up to 100). */
export function readStaffPackageInvoiceRequests(api: FoundationAuthenticatedApi) {
  return settlePackageStaffCommand(
    api.rpc("get_staff_package_invoice_requests", {}, { get: false }),
    z.strictObject({
      items: z.array(staffPackageInvoiceRequestSchema).max(100),
      open: z.number().int().nonnegative(),
      approval_above_cents: cents,
    })
  );
}

const staffIssueResult = requestSchema(staffBase, {
  invoice: staffInvoiceSchema.nullable(),
  repeated: z.boolean(),
});

export const issueStaffPackageInvoiceInput = z.strictObject({
  requestId: z.uuid(),
  dueDays: z.number().int().min(1).max(30),
  reason: z.string().trim().min(5).max(500),
});

/** Issues the invoice of a request (audited); above R50 000 it is prepared for
 * a second staff member's approval instead, and no number is taken yet. */
export function issueStaffPackageInvoice(
  api: FoundationAuthenticatedApi,
  input: z.infer<typeof issueStaffPackageInvoiceInput>
) {
  const value = issueStaffPackageInvoiceInput.parse(input);
  return settlePackageStaffCommand(
    api.rpc(
      "issue_staff_package_invoice",
      {
        p_request_id: value.requestId.toLowerCase(),
        p_due_days: value.dueDays,
        p_reason: staffReason.parse(value.reason),
      },
      { get: false }
    ),
    staffIssueResult
  );
}

/** A second staff member issues a prepared invoice above R50 000 (audited). */
export function approveStaffPackageInvoice(api: FoundationAuthenticatedApi, requestId: string) {
  return settlePackageStaffCommand(
    api.rpc(
      "approve_staff_package_invoice",
      { p_request_id: z.uuid().parse(requestId).toLowerCase() },
      { get: false }
    ),
    requestSchema(staffBase, {
      status: z.literal("issued"),
      invoice: staffInvoiceSchema,
      repeated: z.boolean(),
    })
  );
}

/** Closes an open request with a reason; nothing is issued (audited). */
export function declineStaffPackageInvoiceRequest(
  api: FoundationAuthenticatedApi,
  requestId: string,
  reason: string
) {
  return settlePackageStaffCommand(
    api.rpc(
      "decline_staff_package_invoice_request",
      {
        p_request_id: z.uuid().parse(requestId).toLowerCase(),
        p_reason: staffReason.parse(reason),
      },
      { get: false }
    ),
    requestSchema(staffBase, { status: z.literal("declined"), repeated: z.boolean() })
  );
}
