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
import type { FoundationRefusal } from "./owner-route";
import { createFoundationServiceApi } from "./service-api";
import { FoundationBillingError, openFoundationInvoiceCheckout } from "./billing-runtime";
import { BILLING_EMAIL } from "../billing/slot-checkout";

/**
 * Customer invoices (roadmap P2b, update 20261114041000): staff issue an
 * invoice for a customer's Individual slots; the customer adds billing details,
 * ticks the cooling-off box and pays it with Ozow ("Pay now"). The database
 * owns the number, price, owner, status and every rule; these adapters only
 * check the shape of what it answers and put its refusals in plain words.
 */

/** VM-YYYY-NNNNNN, as the database writes it. */
const INVOICE_NUMBER_PATTERN = /^VM-\d{4}-\d{6}$/;
const invoiceNumber = z.string().regex(INVOICE_NUMBER_PATTERN);
const instant = z.iso.datetime({ offset: true });
const cents = z.number().int().positive().max(5_000_000);
const paymentStatus = z.enum([
  "pending",
  "complete",
  "failed",
  "cancelled",
  "expired",
  "refunded",
  "chargeback",
]);
const CUSTOMER_INVOICE_CONSENT_VERSION = "invoice-cooling-off-v1";

export const customerInvoiceSchema = z.strictObject({
  invoice_id: z.uuid(),
  invoice_number: invoiceNumber,
  status: z.enum(["issued", "paid", "void"]),
  issued_at: instant,
  due_on: z.iso.date(),
  seller: z.strictObject({
    legal_name: z.string().min(1).max(120),
    registration_number: z.string().min(1).max(40),
    // The invoice says "not registered for VAT"; a VAT-registered seller needs
    // a reviewed change first, so anything else is not shown.
    vat_registered: z.literal(false),
  }),
  buyer: z
    .strictObject({
      name: z.string().min(2).max(160),
      address: z.string().min(5).max(300),
      registration_number: z.string().min(2).max(40).nullable(),
    })
    .nullable(),
  revision: z.number().int().positive(),
  term_days: z.union([z.literal(30), z.literal(90), z.literal(180)]),
  slots: z.number().int().min(1).max(25),
  unit_price_cents: cents,
  total_cents: cents,
  description: z.string().min(3).max(200),
  currency: z.literal("ZAR"),
  payment_reference: invoiceNumber,
  cooling_off_consent_at: instant.nullable(),
  cooling_off_consent_version: z.literal(CUSTOMER_INVOICE_CONSENT_VERSION).nullable(),
  consent: z.strictObject({
    version: z.literal(CUSTOMER_INVOICE_CONSENT_VERSION),
    wording: z.string().min(10).max(300),
  }),
  paid_at: instant.nullable(),
  payment_id: z.uuid().nullable(),
  payment_status: paymentStatus.nullable(),
  voided_at: instant.nullable(),
  latest_attempt: z
    .strictObject({
      payment_id: z.uuid(),
      attempt: z.number().int().min(1).max(20),
      status: paymentStatus,
      checkout_open: z.boolean(),
    })
    .nullable(),
});
export type CustomerInvoice = z.infer<typeof customerInvoiceSchema>;

export const staffInvoiceSchema = customerInvoiceSchema.extend({
  account_id: z.uuid(),
  customer_email: z.string().max(254).nullable(),
  customer_name: z.string().max(120).nullable(),
  issued_by_me: z.boolean(),
  issued_by_name: z.string().max(120).nullable(),
  issue_reason: z.string().min(5).max(500),
  void_reason: z.string().min(5).max(500).nullable(),
  attempts: z.number().int().min(0).max(20),
});
export type StaffInvoice = z.infer<typeof staffInvoiceSchema>;

const myInvoiceItem = z.strictObject({
  invoice_number: invoiceNumber,
  status: z.enum(["issued", "paid", "void"]),
  issued_at: instant,
  due_on: z.iso.date(),
  description: z.string().min(3).max(200),
  total_cents: cents,
  paid_at: instant.nullable(),
  payment_status: paymentStatus.nullable(),
});

/** A refusal or outage of a customer invoice command, in the member's words. */
export class FoundationInvoiceError extends Error {
  override name = "FoundationInvoiceError";
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

const MEMBER_REFUSALS: ReadonlyMap<
  FoundationErrorReason,
  readonly [FoundationInvoiceError["status"], string]
> = new Map([
  ["invoice_unavailable", [404, "We could not find that invoice."]],
  ["invoice_paid", [409, "This invoice is already paid."]],
  [
    "invoice_void",
    [409, `This invoice was cancelled. Email ${BILLING_EMAIL} if you still need one.`],
  ],
  [
    "invoice_billing_invalid",
    [
      422,
      "Enter your business or full name (2 to 160 characters), your address (5 to 300 characters) and, if you have one, a registration number of letters and digits.",
    ],
  ],
  ["invoice_billing_required", [409, "Add your billing details before you pay."]],
  ["invoice_revision_changed", [409, "This invoice changed. Reload the page and try again."]],
  [
    "invoice_consent_required",
    [422, "Tick the box to confirm that your slots start as soon as you pay."],
  ],
  ["invoice_amount_mismatch", [409, "The invoice total changed. Reload the page."]],
  [
    "invoice_plan_unavailable",
    [409, `This invoice can no longer be paid online. Email ${BILLING_EMAIL} for a new one.`],
  ],
  [
    "invoice_buyer_unverified",
    [
      403,
      "Your ID review must be accepted before you pay, so you never pay for days you cannot use.",
    ],
  ],
  [
    "invoice_payment_checking",
    [409, "Your last payment of this invoice is still being checked. Try again in a few minutes."],
  ],
  [
    "invoice_checkout_open",
    [409, "You have another payment open for this slot term. Finish or cancel it, then try again."],
  ],
  [
    "invoice_attempts_exhausted",
    [429, `This invoice has had too many payment attempts. Email ${BILLING_EMAIL}.`],
  ],
  [
    "slot_limit_reached",
    [
      409,
      "Paying this invoice would give you more Individual slots than your limit, counting payments still open. Finish or cancel an open payment, or wait until a slot ends.",
    ],
  ],
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
        : "The invoice could not be loaded. Please try again in a few minutes.",
      error.code === "22023" ? "invoice_invalid" : "invoice_unavailable"
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new FoundationInvoiceError(
      503,
      "The invoice could not be loaded. Please try again in a few minutes.",
      "invoice_response_invalid"
    );
  return parsed.data;
}

/** The member's invoices, newest first (up to 100). */
export async function readMyInvoices(api: FoundationAuthenticatedApi) {
  return (
    await settleMemberCommand(
      api.rpc("get_my_invoices", {}, { get: false }),
      z.strictObject({ items: z.array(myInvoiceItem).max(100) })
    )
  ).items;
}

/** One of the member's invoices; null when it is not theirs (or no such number). */
export async function readMyInvoice(
  api: FoundationAuthenticatedApi,
  number: string
): Promise<CustomerInvoice | null> {
  const value = number.trim().toUpperCase();
  if (!INVOICE_NUMBER_PATTERN.test(value)) return null;
  try {
    return await settleMemberCommand(
      api.rpc("get_my_invoice", { p_invoice_number: value }, { get: false }),
      customerInvoiceSchema
    );
  } catch (error) {
    if (error instanceof FoundationInvoiceError && error.status === 404) return null;
    throw error;
  }
}

export const invoiceBillingInput = z.strictObject({
  invoiceNumber: invoiceNumber,
  revision: z.number().int().positive(),
  buyerName: z.string().max(400),
  buyerAddress: z.string().max(800),
  buyerRegistrationNumber: z.string().max(100).nullable().optional(),
});
export type InvoiceBillingInput = z.infer<typeof invoiceBillingInput>;

/** Saves the billing details of an unpaid invoice at its current revision. */
export function saveMyInvoiceBilling(api: FoundationAuthenticatedApi, input: InvoiceBillingInput) {
  const value = invoiceBillingInput.parse(input);
  return settleMemberCommand(
    api.rpc(
      "save_my_invoice_billing",
      {
        p_invoice_number: value.invoiceNumber,
        p_revision: value.revision,
        p_buyer_name: value.buyerName,
        p_buyer_address: value.buyerAddress,
        p_buyer_registration_number: value.buyerRegistrationNumber?.trim() || null,
      },
      { get: false }
    ),
    customerInvoiceSchema.extend({ repeated: z.boolean() })
  );
}

export const invoicePaymentInput = z.strictObject({
  invoiceNumber: invoiceNumber,
  expectedTotalCents: cents,
  coolingOffConsent: z.boolean(),
});
export type InvoicePaymentInput = z.infer<typeof invoicePaymentInput>;

const invoiceQuote = z.strictObject({
  payment_id: z.uuid(),
  merchant_reference: z.string().min(1).max(100),
  amount_cents: z.string().regex(/^[0-9]{1,12}$/),
  currency: z.literal("ZAR"),
  status: z.literal("pending"),
  slots: z.number().int().min(1).max(25),
  reused: z.boolean(),
});

/**
 * "Pay now": the database starts (or returns) the invoice's Ozow payment, then
 * the Ozow request is opened as for any checkout. Returns Ozow's page. The
 * consent box must be ticked; the database records it once.
 */
export async function startMyInvoicePayment(
  api: FoundationAuthenticatedApi,
  ownerId: string,
  input: InvoicePaymentInput,
  appUrl: string,
  service = createFoundationServiceApi()
) {
  const value = invoicePaymentInput.parse(input);
  if (value.coolingOffConsent !== true)
    throw new FoundationInvoiceError(
      422,
      "Tick the box to confirm that your slots start as soon as you pay.",
      "invoice_refused"
    );
  const quote = await settleMemberCommand(
    api.rpc(
      "start_invoice_payment",
      {
        p_invoice_number: value.invoiceNumber,
        p_expected_total_cents: value.expectedTotalCents,
        p_cooling_off_consent: true,
      },
      { get: false }
    ),
    invoiceQuote
  );
  // The payment the database answered is this invoice's (its reference).
  if (!quote.merchant_reference.startsWith(value.invoiceNumber))
    throw new FoundationInvoiceError(
      503,
      "The payment could not be started. Please try again in a few minutes.",
      "invoice_response_invalid"
    );
  return openFoundationInvoiceCheckout(quote, ownerId, appUrl, service);
}

/** The route's answer for an invoice refusal, a checkout refusal or bad input. */
export function invoiceRouteRefusal(error: unknown): FoundationRefusal | null {
  if (error instanceof z.ZodError)
    return { status: 400, error: "Check the details and try again.", reason: "invoice_invalid" };
  if (error instanceof FoundationInvoiceError)
    return { status: error.status, error: error.message, reason: error.code };
  if (error instanceof FoundationBillingError)
    return error.status >= 500
      ? null
      : { status: error.status, error: error.message, reason: error.code ?? "billing_refused" };
  return null;
}

// ---------------------------------------------------------------- staff

const STAFF_REFUSALS: ReadonlyMap<FoundationErrorReason, [number, string]> = new Map([
  [
    "invoice_issue_invalid",
    [422, "Enter the customer's email, the slot term, the number of slots and the days to pay."],
  ],
  ["invoice_account_unavailable", [404, "No confirmed account has that email."]],
  [
    "payment_account_unavailable",
    [409, "The customer's account cannot use slots now (closed or blocked)."],
  ],
  ["invoice_plan_unavailable", [409, "No slot for that term is on sale now."]],
  [
    "invoice_buyer_unverified",
    [409, "The customer's ID review must be accepted before an invoice is issued."],
  ],
  ["invoice_amount_above_limit", [422, "Invoices above R50 000 cannot be issued yet."]],
  [
    "slot_limit_reached",
    [409, "The person would hold more slots than their limit. Raise the limit first."],
  ],
  [
    "invoice_vat_status_changed",
    [409, "The VAT registration setting changed. Invoices need updating before one is issued."],
  ],
  [
    "invoice_request_conflict",
    [409, "This form was already used for another invoice. Reload the page and try again."],
  ],
  ["invoice_unavailable", [404, "No such invoice."]],
  ["invoice_paid", [409, "This invoice is paid: refund the payment instead."]],
  ["invoice_void", [409, "This invoice is already void."]],
  [
    "invoice_payment_open",
    [409, "A payment of this invoice is still open at Ozow. Try again when it has closed."],
  ],
  [
    "staff_review_required",
    [403, "You need a current accepted ID review of your own to issue invoices."],
  ],
  ["staff_same_identity", [403, "Another staff member must invoice your own account."]],
  ["staff_referred_customer", [403, "Another staff member must invoice a customer you referred."]],
]);

async function settleInvoiceStaffCommand<T>(result: RpcResult, schema: z.ZodType<T>): Promise<T> {
  const settled = await result;
  const refusal = lookupDatabaseReason(STAFF_REFUSALS, settled.error);
  if (refusal) throw new FoundationStaffCommandError(refusal[0], refusal[1]);
  return settleStaffCommand(Promise.resolve(settled), schema);
}

export const issueStaffInvoiceInput = z.strictObject({
  accountEmail: z.string().trim().min(3).max(254),
  termDays: z.union([z.literal(30), z.literal(90), z.literal(180)]),
  slots: z.number().int().min(1).max(25),
  dueDays: z.number().int().min(1).max(30),
  reason: z.string().trim().min(5).max(500),
  requestId: z.uuid(),
});
export type IssueStaffInvoiceInput = z.infer<typeof issueStaffInvoiceInput>;

/** Issues an invoice (audited). The same request id again returns the first. */
export function issueStaffInvoice(api: FoundationAuthenticatedApi, input: IssueStaffInvoiceInput) {
  const value = issueStaffInvoiceInput.parse(input);
  return settleInvoiceStaffCommand(
    api.rpc(
      "issue_staff_invoice",
      {
        p_account_email: value.accountEmail,
        p_term_days: value.termDays,
        p_slots: value.slots,
        p_due_days: value.dueDays,
        p_reason: staffReason.parse(value.reason),
        p_request_id: value.requestId,
      },
      { get: false }
    ),
    staffInvoiceSchema.extend({ repeated: z.boolean() })
  );
}

/** Voids an unpaid invoice no payment attempt can still pay (audited). */
export function voidStaffInvoice(
  api: FoundationAuthenticatedApi,
  invoiceId: string,
  reason: string
) {
  return settleInvoiceStaffCommand(
    api.rpc(
      "void_staff_invoice",
      { p_invoice_id: z.uuid().parse(invoiceId), p_reason: staffReason.parse(reason) },
      { get: false }
    ),
    staffInvoiceSchema.extend({ status: z.literal("void"), repeated: z.boolean() })
  );
}

/** The latest 50 invoices and how many are unpaid. */
export function readStaffInvoices(api: FoundationAuthenticatedApi) {
  return settleInvoiceStaffCommand(
    api.rpc("get_staff_invoices", {}, { get: false }),
    z.strictObject({
      unpaid: z.number().int().nonnegative(),
      items: z.array(staffInvoiceSchema).max(50),
    })
  );
}

/** One invoice by number as staff see it; null when there is none. */
export async function readStaffInvoice(
  api: FoundationAuthenticatedApi,
  number: string
): Promise<StaffInvoice | null> {
  const value = number.trim().toUpperCase();
  if (!INVOICE_NUMBER_PATTERN.test(value)) return null;
  try {
    return await settleInvoiceStaffCommand(
      api.rpc("get_staff_invoice", { p_invoice_number: value }, { get: false }),
      staffInvoiceSchema
    );
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.status === 404) return null;
    throw error;
  }
}
