import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { createFoundationServiceApi, type FoundationServiceApi } from "./service-api";
import {
  cancelOzowPaymentRequest,
  createOzowHostedPayment,
  getOzowPaymentRequestStatus,
  isMockOzowEnabled,
  listOzowPaymentTransactions,
  MOCK_OZOW_REQUEST_PREFIX,
  type NormalizedOzowWebhook,
} from "../payments/ozow";
import {
  confirmationRefusalCode,
  isRetryableConfirmationRefusal,
  validateOzowConfirmation,
} from "../payments/confirmation";
import { createLogger } from "../utils/logger";
import { recordPaymentProblem, type PaymentProblemSource } from "./payment-problems";
import {
  ADDON_SALES_PAUSED_CODE,
  ADDON_SALES_PAUSED_MESSAGE,
  areAddonSalesOpen,
} from "../billing/addon-sales";
import { PRODUCTION_CHECKOUT_ORIGIN, testCopyCheckout } from "../payments/checkout-origins";
import type { PaymentRecordShape } from "../payments/types";

type BillingRpcName =
  | "get_my_billing"
  | "get_my_payment"
  | "get_checkout_payment"
  | "claim_checkout_request"
  | "complete_checkout_request"
  | "claim_payment_reconciliation"
  | "list_reconcilable_payments"
  | "finish_unpaid_checkout"
  | "expire_stale_checkouts"
  | "manage_plan_member"
  | "apply_provider_event"
  | "start_checkout"
  | "start_slot_checkout"
  | "get_my_slots";
type BillingRpc = {
  rpc: (
    name: BillingRpcName,
    args?: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};
const log = createLogger("FoundationPayments");
// The transport is deliberately limited to this closed command set. Callers
// still construct an authenticated or service-role client, never an admin table client.
const billingRpc = (api: FoundationAuthenticatedApi | FoundationServiceApi) =>
  api as unknown as BillingRpc;

const instant = z.string().pipe(z.iso.datetime({ offset: true }));
const cents = z
  .string()
  .regex(/^[0-9]{1,12}$/)
  .refine((value) => Number.isSafeInteger(Number(value)));
export const foundationPaymentSchema = z.strictObject({
  id: z.uuid(),
  owner_id: z.uuid(),
  product_kind: z.enum(["plan", "addon"]),
  product_id: z.uuid(),
  target_post_id: z.uuid().nullable(),
  amount_cents: cents,
  currency: z.literal("ZAR"),
  status: z.enum([
    "pending",
    "complete",
    "failed",
    "cancelled",
    "expired",
    "refunded",
    "chargeback",
  ]),
  fulfillment_status: z.enum(["unfulfilled", "fulfilled", "needs_reconciliation", "reversed"]),
  merchant_reference: z.string().min(1).max(100),
  provider_request_id: z.string().min(1).max(100).nullable(),
  provider_transaction_id: z.string().min(1).max(100).nullable(),
  checkout_url: z.string().url().nullable(),
  checkout_expires_at: instant.nullable(),
  created_at: instant,
  label: z.string().max(200).nullable(),
});
export type FoundationPayment = z.infer<typeof foundationPaymentSchema>;
const billingSchema = z.strictObject({
  payments: z.array(foundationPaymentSchema).max(100),
  invoices: z
    .array(
      z.strictObject({
        id: z.uuid(),
        payment_id: z.uuid(),
        invoice_number: z.string().min(1).max(100),
        total_cents: cents,
        amount_ex_vat_cents: cents,
        vat_cents: cents,
        description: z.string().max(500),
        issued_at: instant,
        payment_status: foundationPaymentSchema.shape.status,
      })
    )
    .max(100),
  entitlements: z
    .array(
      z.strictObject({
        id: z.uuid(),
        area: z.enum(["market", "business", "tourism_events"]).nullable(),
        source: z.enum(["retail_paid", "intro_trial", "sponsorship", "contract", "staff_grant"]),
        status: z.literal("active"),
        slot_capacity: z.number().int().positive(),
        max_photos: z.number().int().positive(),
        max_videos: z.number().int().nonnegative(),
        addon_capabilities: z.array(z.enum(["boost", "featured", "urgent"])).max(3),
        starts_at: instant,
        ends_at: instant,
        used: z.number().int().nonnegative(),
      })
    )
    .max(1000),
});
export type FoundationBilling = z.infer<typeof billingSchema>;

export class FoundationBillingError extends Error {
  override name = "FoundationBillingError";
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    message = "Billing could not be completed",
    readonly code?: string
  ) {
    super(message);
  }
}
/** The restored checkout page's reply for a plan that already has an open
 * Ozow request (src/app/billing/checkout/checkout-confirm.tsx): continue it,
 * check its status, or cancel it. The same shape as the retired route's. */
export interface FoundationPendingPayment {
  id: string;
  checkoutUrl: string | null;
  statusUrl: string;
  canCancel: boolean;
  /** What the unpaid order is for, when it holds Individual slots: its number
   * of slots and its total, which may differ from what the page now shows. */
  slots?: number;
  amountCents?: number;
}
export class FoundationPendingPaymentError extends FoundationBillingError {
  override name = "FoundationPendingPaymentError";

  constructor(readonly pendingPayment: FoundationPendingPayment) {
    super(
      409,
      "You already have a pending payment for this area. Continue the payment or cancel it before choosing another plan.",
      "PENDING_PAYMENT_EXISTS"
    );
  }
}
/** A database command's refusal or outage (`command` below). */
class FoundationBillingCommandError extends FoundationBillingError {
  override name = "FoundationBillingCommandError";
}
/** The slot checkout's refusals (api.start_slot_checkout) in the member's
 * words, with a code the checkout page can act on. Nothing was charged. */
const SLOT_CHECKOUT_REFUSALS: Readonly<
  Record<string, readonly [status: 400 | 403 | 409, message: string, code: string]>
> = {
  PT412: [
    403,
    "Your ID review must be accepted before you buy a slot, so you never pay for days you cannot use.",
    "ID_REVIEW_REQUIRED",
  ],
  PT413: [
    400,
    "Orders above R10,000 are paid by invoice. Email billing@verifymzansi.com to ask for one.",
    "INVOICE_REQUIRED",
  ],
  PT428: [409, "The price changed. Check the total and try again.", "PRICE_CHANGED"],
  PT429: [
    409,
    "You have reached the most Individual slots you can hold at once, counting payments still open. Finish or cancel an open payment, or wait until a slot ends.",
    "SLOT_LIMIT_REACHED",
  ],
};
/** A status check that found something staff must look at. `reason` is a
 * reason code for the logs and the status-check job's report; members only
 * ever see the message. */
export class FoundationPaymentCheckError extends FoundationBillingError {
  override name = "FoundationPaymentCheckError";
  constructor(
    readonly reason: string,
    message: string
  ) {
    super(503, message);
  }
}
const addonSalesPaused = () =>
  new FoundationBillingError(403, ADDON_SALES_PAUSED_MESSAGE, ADDON_SALES_PAUSED_CODE);
async function command(
  api: FoundationAuthenticatedApi | FoundationServiceApi,
  name: BillingRpcName,
  args: Record<string, unknown> = {}
) {
  const { data, error } = await billingRpc(api).rpc(name, args);
  const refusal =
    error && name === "start_slot_checkout" ? SLOT_CHECKOUT_REFUSALS[error.code ?? ""] : null;
  if (refusal) throw new FoundationBillingCommandError(...refusal);
  if (error)
    throw new FoundationBillingCommandError(
      error.code === "42501" || error.code === "PT403"
        ? 403
        : error.code === "22023"
          ? 400
          : ["PT409", "23505"].includes(error.code ?? "")
            ? 409
            : 503
    );
  return data;
}
export async function readFoundationBilling(
  api: FoundationAuthenticatedApi
): Promise<FoundationBilling> {
  return billingSchema.parse(await command(api, "get_my_billing"));
}
const slotPostSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["listing", "business", "event"]),
  area: z.enum(["market", "business", "tourism_events"]),
  title: z.string().max(200).nullable(),
  status: z.enum([
    "draft",
    "pending_moderation",
    "live",
    "paused",
    "rejected",
    "expired",
    "sold",
    "archived",
  ]),
  deletes_at: instant.nullable(),
});
const mySlotsSchema = z.strictObject({
  slots: z
    .array(
      z.strictObject({
        id: z.uuid(),
        source: z.enum(["retail_paid", "intro_trial", "sponsorship", "contract", "staff_grant"]),
        individual: z.boolean(),
        label: z.string().max(200).nullable(),
        area: z.enum(["market", "business", "tourism_events"]).nullable(),
        starts_at: instant,
        ends_at: instant,
        state: z.enum(["active", "ended"]),
        places: z.number().int().positive(),
        sponsor: z.string().max(200).nullable(),
        posts: z.array(slotPostSchema).max(1000),
      })
    )
    .max(200),
  individual: z.strictObject({
    verified: z.boolean(),
    held: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    limit: z.number().int().min(4).max(25),
    limit_ends_at: instant.nullable(),
  }),
});
export type FoundationMySlots = z.infer<typeof mySlotsSchema>;
/** Every slot the member holds (and ended ones for 3 days), with the posts in
 * them, and their Individual slot count and limit. */
export async function readFoundationMySlots(
  api: FoundationAuthenticatedApi
): Promise<FoundationMySlots> {
  return mySlotsSchema.parse(await command(api, "get_my_slots"));
}
export async function readFoundationPayment(
  api: FoundationAuthenticatedApi,
  paymentId: string
): Promise<FoundationPayment | null> {
  const data = await command(api, "get_my_payment", { p_payment_id: z.uuid().parse(paymentId) });
  return data === null ? null : foundationPaymentSchema.parse(data);
}
async function readFoundationServicePayment(
  service: FoundationServiceApi,
  selector: { id?: string; reference?: string }
) {
  const data = await command(service, "get_checkout_payment", {
    p_payment_id: selector.id ?? null,
    p_merchant_reference: selector.reference ?? null,
  });
  return data === null ? null : foundationPaymentSchema.parse(data);
}

/** Test copy addresses (src/lib/payments/checkout-origins.ts), only while the
 * provider really is the mock, so a test address never reaches Ozow. Null with
 * production settings, which leaves both checks below exactly as before. */
function testCheckout() {
  const copy = testCopyCheckout();
  return copy && isMockOzowEnabled() ? copy : null;
}
function isTestCopyMockPayment(url: URL) {
  const copy = testCheckout();
  return copy !== null && !url.username && !url.password && url.origin === copy.mockPaymentOrigin;
}

function checkoutRedirect(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["ozow.com", "pay.ozow.com", "secure.ozow.com", "one.ozow.com", "stagingone.ozow.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )) &&
    !isTestCopyMockPayment(url)
  )
    throw new FoundationBillingError(503, "The payment provider returned an invalid checkout URL");
  return url.href;
}
const quoteSchema = z.object({
  payment_id: z.uuid(),
  merchant_reference: z.string().min(1),
  amount_cents: cents,
  currency: z.literal("ZAR"),
  status: z.literal("pending"),
  // The slot checkout says how many slots the payment holds.
  slots: z.number().int().min(1).max(25).optional(),
});
const claimSchema = foundationPaymentSchema.extend({
  claim_token: z.uuid().nullable(),
  idempotency_key: z.uuid(),
  correlation_id: z.uuid(),
});

/** SQL owns price, eligibility, owner and reuse. A persistent lease prevents
 * two HTTP callers creating different requests for the same priced payment. */
export async function startFoundationCheckout(
  api: FoundationAuthenticatedApi,
  ownerId: string,
  productId: string,
  targetPostId: string | null,
  appUrl: string,
  service = createFoundationServiceApi()
) {
  const app = checkoutApp(appUrl);
  // Only add-ons take a target post (internal.start_checkout refuses a plan
  // with one and an add-on without one), so this refuses every add-on before
  // its payment row exists while sales are paused (../billing/addon-sales.ts).
  // Plans are bought with startFoundationSlotCheckout; the database refuses
  // them here.
  if (targetPostId !== null && !areAddonSalesOpen()) throw addonSalesPaused();
  const quote = quoteSchema.parse(
    await command(api, "start_checkout", {
      p_product_id: z.uuid().parse(productId),
      p_target_post: targetPostId === null ? null : z.uuid().parse(targetPostId),
    })
  );
  return openFoundationCheckout(quote, ownerId, app, service);
}

/** One order of Individual slots: the plan (30, 90 or 180 days), how many
 * slots, the total the member was shown and their cooling-off consent. */
export interface FoundationSlotOrder {
  planId: string;
  slots: number;
  expectedTotalCents: number;
  coolingOffConsent: boolean;
}
const slotOrderSchema = z.strictObject({
  planId: z.uuid(),
  slots: z.number().int().min(1).max(25),
  expectedTotalCents: z.number().int().positive().max(100_000_000),
  coolingOffConsent: z.literal(true),
});

/** SQL owns the price (slot price x slots), the consent record, the ID review,
 * the R10,000 online limit and the person's slot limit; a total other than the
 * one shown is refused, so the price shown is the price charged. */
export async function startFoundationSlotCheckout(
  api: FoundationAuthenticatedApi,
  ownerId: string,
  order: FoundationSlotOrder,
  appUrl: string,
  service = createFoundationServiceApi()
) {
  const app = checkoutApp(appUrl);
  const value = slotOrderSchema.parse(order);
  const quote = quoteSchema.parse(
    await command(api, "start_slot_checkout", {
      p_plan_id: value.planId,
      p_slots: value.slots,
      p_expected_total_cents: value.expectedTotalCents,
      p_cooling_off_consent: value.coolingOffConsent,
    })
  );
  return openFoundationCheckout(quote, ownerId, app, service);
}

function checkoutApp(appUrl: string) {
  const app = new URL(appUrl);
  if (
    (app.origin !== PRODUCTION_CHECKOUT_ORIGIN && app.origin !== testCheckout()?.appOrigin) ||
    app.username ||
    app.password
  )
    throw new FoundationBillingError(503);
  return app;
}

/** Leases the quoted payment, then reuses its Ozow request or creates one. */
async function openFoundationCheckout(
  quote: z.infer<typeof quoteSchema>,
  ownerId: string,
  app: URL,
  service: FoundationServiceApi
) {
  const pay = claimSchema.parse(
    await command(service, "claim_checkout_request", {
      p_payment_id: quote.payment_id,
      p_owner_id: ownerId,
    })
  );
  if (
    pay.owner_id !== ownerId ||
    pay.id !== quote.payment_id ||
    pay.amount_cents !== quote.amount_cents
  )
    throw new FoundationBillingError(503);
  // Whatever the quote was for, an add-on payment never reaches the provider
  // (nor gets a stored checkout address back) while sales are paused.
  if (pay.product_kind === "addon" && !areAddonSalesOpen()) throw addonSalesPaused();
  if (pay.checkout_url) {
    const checkoutUrl = checkoutRedirect(pay.checkout_url);
    // A plan's open request goes back to the member as the restored page's
    // choice (continue, check or cancel), never as a silent redirect.
    if (pay.product_kind === "plan" && pay.provider_request_id)
      throw new FoundationPendingPaymentError({
        id: pay.id,
        // Ozow's page for it is gone once its window has passed.
        checkoutUrl:
          pay.checkout_expires_at && Date.parse(pay.checkout_expires_at) > Date.now()
            ? checkoutUrl
            : null,
        statusUrl: `${app.origin}/billing/success?payment=${pay.id}`,
        canCancel: canAskProvider(pay.provider_request_id),
        ...(quote.slots !== undefined && {
          slots: quote.slots,
          amountCents: Number(pay.amount_cents),
        }),
      });
    return { paymentId: pay.id, checkoutUrl };
  }
  if (!pay.claim_token || !pay.checkout_expires_at) throw new FoundationBillingError(503);
  const provider = await createOzowHostedPayment({
    paymentId: pay.id,
    merchantReference: pay.merchant_reference,
    amountCents: Number(pay.amount_cents),
    returnUrl: `${app.origin}/billing/success?payment=${pay.id}`,
    cancelUrl: `${app.origin}/billing/cancel?payment=${pay.id}`,
    idempotencyKey: pay.idempotency_key,
    correlationId: pay.correlation_id,
    expireAt: pay.checkout_expires_at,
  });
  const checkoutUrl = checkoutRedirect(provider.redirectUrl);
  const attached = await command(service, "complete_checkout_request", {
    p_payment_id: pay.id,
    p_owner_id: ownerId,
    p_claim_token: pay.claim_token,
    p_request_id: provider.providerPaymentId,
    p_checkout_url: checkoutUrl,
  });
  if (attached !== true) throw new FoundationBillingError(503);
  return { paymentId: pay.id, checkoutUrl };
}

function confirmationShape(pay: FoundationPayment): PaymentRecordShape {
  return {
    id: pay.id,
    user_id: pay.owner_id,
    area: "MZANSI_MARKET",
    amount_cents: Number(pay.amount_cents),
    status: pay.status,
    provider: "ozow",
    provider_payment_id: pay.provider_request_id,
    provider_reference: pay.merchant_reference,
    created_at: pay.created_at,
    provider_data: pay.provider_transaction_id
      ? { transaction_id: pay.provider_transaction_id }
      : null,
  };
}
/**
 * The repeat-notice key (private.provider_events, unique per provider): the
 * transaction, its status as Ozow reported it, and the signed evidence. A thin
 * notice repeats the same bytes while the looked-up status moves on (Pending,
 * then Successful, Refunded or Error), so the bytes alone would drop the later
 * status as a repeat. An identical repeat still has the same key. A later
 * status reaches the database and is recorded there; it does not reverse a
 * completed payment (a later status is recorded as late_status_ignored; Ozow
 * keeps a refunded payment "Complete", and refunds are followed through their
 * own records, ./ozow-refunds.ts).
 */
export function providerEventKey(payload: NormalizedOzowWebhook, evidence: string): string {
  const evidenceHash = createHash("sha256").update(evidence).digest("hex");
  return createHash("sha256")
    .update(
      JSON.stringify([
        "ozow-provider-event:v2",
        payload.transactionId ?? "",
        payload.status?.toLowerCase() ?? "",
        evidenceHash,
      ])
    )
    .digest("hex");
}

async function applyTransaction(
  service: FoundationServiceApi,
  pay: FoundationPayment,
  payload: NormalizedOzowWebhook,
  evidence: string
) {
  if (validateOzowConfirmation(confirmationShape(pay), payload))
    throw new FoundationBillingError(400, "Payment confirmation did not match its stored quote");
  const status = payload.status?.toLowerCase();
  const reported = status === "successful" ? "complete" : status === "error" ? "error" : "pending";
  return command(service, "apply_provider_event", {
    p_event: {
      payload_sha256: providerEventKey(payload, evidence),
      merchant_reference: pay.merchant_reference,
      provider_request_id: pay.provider_request_id,
      provider_transaction_id: payload.transactionId,
      status: reported,
      amount_cents: Number(pay.amount_cents),
      currency: pay.currency,
    },
  });
}

/** Settlement outcomes that need a person, as payment problem reasons.
 * Refunds are not watched here: Ozow keeps a refunded payment "Complete", so a
 * payment status never reports one. Refunds are followed through their own
 * records (./ozow-refunds.ts: Ozow's refund notices and the daily check of
 * Ozow's refund list, which alerts staff to a refund with no record). */
const SETTLEMENT_PROBLEMS: ReadonlySet<string> = new Set([
  "unknown_reference",
  "request_mismatch",
  "amount_mismatch",
  "missing_transaction",
  "conflicting_transaction",
  "transaction_reused",
  "complete_unfulfillable_target",
]);
function settlementProblem(outcome: unknown) {
  if (typeof outcome !== "string") return null;
  return SETTLEMENT_PROBLEMS.has(outcome) ? outcome : null;
}
/** Records what the database reported, when it needs a person; the
 * settlement itself is already committed. */
async function recordSettlement(
  service: FoundationServiceApi,
  pay: FoundationPayment,
  outcome: unknown,
  reportedStatus: string | null,
  source: PaymentProblemSource,
  transaction: string | null
) {
  const recorded = (outcome as { outcome?: unknown } | null)?.outcome;
  const reason = settlementProblem(recorded);
  if (reason)
    await recordPaymentProblem(service, {
      paymentId: pay.id,
      reason,
      source,
      reportedStatus,
      transaction,
    });
}

/**
 * A correctly signed notice that can never be applied: logged and kept as a
 * payment problem with the payment number and a reason code (no personal
 * data), and acknowledged, so the sender does not retry it for a day and
 * switch the notice address off. The 10-minute status check still settles a
 * real payment from Ozow's own records.
 */
async function refuseOzowNotice(
  service: FoundationServiceApi,
  reason: string,
  paymentId: string | null,
  payload: NormalizedOzowWebhook
) {
  await recordPaymentProblem(service, {
    paymentId,
    reason,
    source: "notice",
    reportedStatus: payload.status,
    transaction: payload.transactionId,
  });
  return { success: true, rejected: reason };
}

/** Only call after verifying the raw Svix signature (including thin-event lookup).
 * Throws only for failures worth retrying (database or settings); a notice that
 * can never apply is refused with a reason (refuseOzowNotice). */
export async function applyFoundationOzowNotification(
  payload: NormalizedOzowWebhook,
  rawBody: string,
  service = createFoundationServiceApi()
) {
  const pay = payload.merchantReference
    ? await readFoundationServicePayment(service, { reference: payload.merchantReference })
    : null;
  if (!pay) return refuseOzowNotice(service, "unknown_payment", null, payload);
  const refusal = validateOzowConfirmation(confirmationShape(pay), payload);
  if (refusal) {
    if (isRetryableConfirmationRefusal(refusal)) {
      log.warn("Ozow notice deferred", {
        paymentId: pay.id,
        reason: confirmationRefusalCode(refusal),
      });
      throw new FoundationBillingError(503, "Payment confirmation cannot be checked yet");
    }
    return refuseOzowNotice(service, confirmationRefusalCode(refusal), pay.id, payload);
  }
  const outcome = await applyTransaction(service, pay, payload, rawBody);
  await recordSettlement(service, pay, outcome, payload.status, "notice", payload.transactionId);
  return { success: true, result: outcome };
}

/** Mock checkouts exist only in test copies and never at Ozow. Production
 * never enables mock Ozow and never stores a mock request id. */
const isMockCheckout = (requestId: string) =>
  isMockOzowEnabled() || requestId.startsWith(MOCK_OZOW_REQUEST_PREFIX);

/** Whether reconciliation may ask a provider about a stored request. Without
 * the test copy (production): only real requests, never in mock mode, exactly
 * as before. In the test copy (mock mode only): only its own mock requests,
 * which its loopback stand-in answers (ozow.ts); never a real request id. */
const canAskProvider = (requestId: string) =>
  testCheckout() !== null
    ? requestId.startsWith(MOCK_OZOW_REQUEST_PREFIX)
    : !isMockCheckout(requestId);

/** `cancelling`: the member's own Cancel (cancelFoundationPendingPayment) just
 * closed the request at Ozow, so a request that reads Cancelled is recorded as
 * the member's cancellation. Otherwise it is recorded as expired, which still
 * lets a verified late success deliver what was paid for. */
export async function reconcileFoundationPayment(
  paymentId: string,
  service = createFoundationServiceApi(),
  { cancelling = false }: { cancelling?: boolean } = {}
) {
  // No provider to ask in mock mode (except the test copy's stand-in): leave
  // the stored state as it is.
  if (isMockOzowEnabled() && testCheckout() === null)
    return { checked: false, pendingTransaction: false };
  const raw = await command(service, "claim_payment_reconciliation", { p_payment_id: paymentId });
  if (raw === null) return { checked: false, pendingTransaction: false };
  const pay = foundationPaymentSchema.parse(raw);
  if (!pay.provider_request_id || !canAskProvider(pay.provider_request_id))
    return { checked: false, pendingTransaction: false };
  const transactions = await listOzowPaymentTransactions(pay.provider_request_id, pay.created_at);
  for (const transaction of transactions) {
    const refusal = validateOzowConfirmation(confirmationShape(pay), transaction);
    if (refusal) {
      const reason = confirmationRefusalCode(refusal);
      await recordPaymentProblem(service, {
        paymentId: pay.id,
        reason,
        source: "status_check",
        reportedStatus: transaction.status,
        transaction: transaction.transactionId,
      });
      throw new FoundationPaymentCheckError(
        reason,
        "Payment reconciliation did not match its stored quote"
      );
    }
  }
  const successful = transactions.filter(
    (transaction) => transaction.status?.toLowerCase() === "successful"
  );
  if (successful.length > 1) {
    // Paid twice on one request: nothing is settled automatically.
    await recordPaymentProblem(service, {
      paymentId: pay.id,
      reason: "multiple_settlements",
      source: "status_check",
      reportedStatus: "successful",
      // The set of successful transactions: a further one alerts again.
      transaction: successful
        .map((entry) => entry.transactionId ?? "")
        .sort()
        .join(","),
    });
    throw new FoundationPaymentCheckError(
      "multiple_settlements",
      "Multiple payment settlements require reconciliation"
    );
  }
  if (successful.length === 1) {
    const outcome = await applyTransaction(
      service,
      pay,
      successful[0],
      `reconciliation:${JSON.stringify(successful[0])}`
    );
    await recordSettlement(
      service,
      pay,
      outcome,
      successful[0].status,
      "status_check",
      successful[0].transactionId
    );
    return { checked: true, pendingTransaction: false, settled: true };
  }
  // Only Successful and Error are final; any other status (Pending,
  // Incomplete, or one this code does not know) is still being decided.
  const pending = transactions.some(
    (transaction) => !["successful", "error"].includes(transaction.status?.toLowerCase() ?? "")
  );
  if (pending || pay.status !== "pending") return { checked: true, pendingTransaction: pending };
  // While the request is open the member can still pay on it, so a declined
  // attempt alone closes nothing here (its notice records it, as before).
  const request = await getOzowPaymentRequestStatus(pay.provider_request_id);
  if (request === "Created") return { checked: true, pendingTransaction: false };
  // The request is closed (expired, or cancelled at Ozow or by the member): no
  // attempt can succeed any more. A declined or cancelled bank attempt (Ozow
  // status Error) records the payment as not paid, exactly as its notice
  // would, so the member no longer waits on "Payment pending".
  const declined = transactions.find(
    (transaction) => transaction.status?.toLowerCase() === "error"
  );
  if (declined) {
    const recorded = await applyTransaction(
      service,
      pay,
      declined,
      `reconciliation:${JSON.stringify(declined)}`
    );
    return {
      checked: true,
      pendingTransaction: false,
      closed: (recorded as { outcome?: unknown } | null)?.outcome === "not_paid",
    };
  }
  const finished = await command(service, "finish_unpaid_checkout", {
    p_payment_id: pay.id,
    p_status: request === "Cancelled" && cancelling ? "cancelled" : "expired",
  });
  return { checked: true, pendingTransaction: false, closed: finished === true };
}

export async function cancelFoundationPendingPayment(
  api: FoundationAuthenticatedApi,
  paymentId: string,
  service = createFoundationServiceApi()
) {
  const pay = await readFoundationPayment(api, paymentId);
  if (!pay) throw new FoundationBillingError(404, "Payment not found");
  if (pay.status !== "pending" || !pay.provider_request_id)
    throw new FoundationBillingError(
      409,
      "Check this payment's status before starting another checkout"
    );
  // A mock checkout has no provider evidence to close it with: refuse, except
  // in the private test copy, whose stand-in answers for its own mock requests.
  if (!canAskProvider(pay.provider_request_id)) throw new FoundationBillingError(409);
  await cancelOzowPaymentRequest(pay.provider_request_id);
  // A simultaneous settlement must win. The private row CAS and the provider
  // evidence both have to agree before the pending checkout is closed.
  const result = await reconcileFoundationPayment(pay.id, service, { cancelling: true });
  if (!result.checked || result.pendingTransaction || result.settled)
    throw new FoundationBillingError(409, "The bank transaction is still being checked");
  // The status check itself closed it from the provider's answer.
  if (result.closed) return { success: true };
  if (
    (await command(service, "finish_unpaid_checkout", {
      p_payment_id: pay.id,
      p_status: "cancelled",
    })) !== true
  )
    throw new FoundationBillingError(409, "The payment status changed; check it again");
  return { success: true };
}

/** Closes pending payments that never got an Ozow request (a failed first
 * call) after an hour, so the member's next checkout starts a new payment.
 * Safe to repeat; payments with a request are left to the status check. */
async function expireStaleCheckouts(service: FoundationServiceApi) {
  return z
    .number()
    .int()
    .nonnegative()
    .parse(await command(service, "expire_stale_checkouts", { p_limit: 100 }));
}

/** A log-safe reason code for a failed status check or sweep: a payment
 * problem's own reason, or the kind of outage. Never the error text. */
export function paymentCheckFailureReason(error: unknown): string {
  if (error instanceof FoundationPaymentCheckError) return error.reason;
  if (error instanceof FoundationBillingCommandError)
    return error.status === 503 ? "database_unavailable" : "database_refused";
  if (error instanceof FoundationBillingError)
    return error.status >= 500 ? "billing_unavailable" : "billing_refused";
  if (error instanceof z.ZodError) return "invalid_record";
  const name = error instanceof Error ? error.name : "";
  if (name === "OzowProviderError") return "provider_unavailable";
  if (name === "OzowAuthenticationError") return "provider_sign_in_failed";
  if (name === "OzowConfigurationError") return "provider_settings";
  if (error instanceof TypeError) return "network_error";
  return "unexpected_error";
}

export interface PaymentCheckFailure {
  /** Null for the sweep of payments that never got a request. */
  paymentId: string | null;
  reason: string;
}

/** The status-check job: the sweep, then up to 20 payments. Every failure is
 * logged with its payment number and reason and listed in `errors`; one
 * payment's failure never stops the others. */
export async function runFoundationPaymentReconciliation(service = createFoundationServiceApi()) {
  let expired = 0;
  let failures = 0;
  const errors: PaymentCheckFailure[] = [];
  const failed = (paymentId: string | null, error: unknown) => {
    failures++;
    const reason = paymentCheckFailureReason(error);
    errors.push({ paymentId, reason });
    log.error("Payment status check failed", { paymentId, reason });
  };
  try {
    expired = await expireStaleCheckouts(service);
  } catch (error) {
    // Counted as a failure; the status checks below still run.
    failed(null, error);
  }
  const payments = z
    .array(foundationPaymentSchema)
    .max(50)
    .parse(await command(service, "list_reconcilable_payments", { p_limit: 20 }));
  let checked = 0;
  for (const pay of payments) {
    try {
      if ((await reconcileFoundationPayment(pay.id, service)).checked) checked++;
    } catch (error) {
      failed(pay.id, error);
    }
  }
  return { checked, failures, expired, errors };
}

export async function manageFoundationPlanMember(api: FoundationAuthenticatedApi, input: unknown) {
  const value = z
    .strictObject({
      entitlementId: z.uuid(),
      action: z.enum(["add", "remove"]),
      email: z.email().max(254),
    })
    .parse(input);
  return command(api, "manage_plan_member", {
    p_entitlement_id: value.entitlementId,
    p_action: value.action,
    p_email: value.email,
  });
}
