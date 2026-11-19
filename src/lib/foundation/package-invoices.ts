import "server-only";

import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  hasDatabaseMessage,
  lookupDatabaseReason,
  type FoundationErrorReason,
} from "./error-reasons";
import { staffReason } from "./organisations";
import { FoundationStaffCommandError, settleStaffCommand } from "./staff-command";
import { FoundationInvoiceError, staffInvoiceSchema } from "./customer-invoices";
import { BILLING_EMAIL } from "../billing/slot-checkout";
import { PACKAGE_MAX_SLOTS, PACKAGE_MIN_SLOTS } from "../billing/slot-packages";

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

export const packageInvoiceRequestSchema = z.strictObject({
  request_id: z.uuid(),
  status: z.enum(["requested", "awaiting_approval", "issued", "declined", "withdrawn"]),
  term_days: term,
  slots: z.number().int().min(PACKAGE_MIN_SLOTS).max(PACKAGE_MAX_SLOTS),
  unit_price_cents: cents,
  total_cents: cents,
  requested_at: instant,
  invoice_number: z.string().regex(INVOICE_NUMBER).nullable(),
  closed_at: instant.nullable(),
});
export type PackageInvoiceRequest = z.infer<typeof packageInvoiceRequestSchema>;

export const staffPackageInvoiceRequestSchema = packageInvoiceRequestSchema.extend({
  account_id: z.uuid(),
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
});
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
]);

type RpcResult = PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
}>;

async function settleMemberCommand<T>(result: RpcResult, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await result;
  if (error) {
    const refusal = lookupDatabaseReason(MEMBER_REFUSALS, error);
    if (refusal) throw new FoundationInvoiceError(refusal[0], refusal[1], "invoice_refused");
    if (error.code === "PT412")
      throw new FoundationInvoiceError(
        403,
        "Your ID review must be accepted before you ask for a package invoice, so you never pay for days you cannot use.",
        "invoice_refused"
      );
    if (error.code === "PT428")
      throw new FoundationInvoiceError(
        409,
        "The price changed. Check the total and try again.",
        "invoice_refused"
      );
    if (
      hasDatabaseMessage(error, "liveSessionRequired") ||
      hasDatabaseMessage(error, "activeMemberRequired")
    )
      throw new FoundationInvoiceError(
        403,
        "Your account cannot use invoices right now. Sign in again or contact us.",
        "member_required"
      );
    throw new FoundationInvoiceError(
      error.code === "22023" ? 422 : 503,
      error.code === "22023"
        ? "Check the details and try again."
        : "Your request could not be sent. Please try again in a few minutes.",
      error.code === "22023" ? "invoice_invalid" : "invoice_unavailable"
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new FoundationInvoiceError(
      503,
      "Your request could not be confirmed. Please try again in a few minutes.",
      "invoice_response_invalid"
    );
  return parsed.data;
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
    packageInvoiceRequestSchema.extend({ repeated: z.boolean() })
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

const staffIssueResult = staffPackageInvoiceRequestSchema.extend({
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
    staffIssueResult.extend({ status: z.literal("issued"), invoice: staffInvoiceSchema })
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
    staffPackageInvoiceRequestSchema.extend({
      status: z.literal("declined"),
      repeated: z.boolean(),
    })
  );
}
