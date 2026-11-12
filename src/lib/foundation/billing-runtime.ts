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
  | "manage_plan_member"
  | "apply_provider_event"
  | "start_checkout";
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
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 503,
    message = "Billing could not be completed",
    readonly code?: string
  ) {
    super(message);
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
  if (error)
    throw new FoundationBillingError(
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
  const app = new URL(appUrl);
  if (
    (app.origin !== PRODUCTION_CHECKOUT_ORIGIN && app.origin !== testCheckout()?.appOrigin) ||
    app.username ||
    app.password
  )
    throw new FoundationBillingError(503);
  // Only add-ons take a target post (internal.start_checkout refuses a plan
  // with one and an add-on without one), so this refuses every add-on before
  // its payment row exists while sales are paused (../billing/addon-sales.ts).
  if (targetPostId !== null && !areAddonSalesOpen()) throw addonSalesPaused();
  const quote = quoteSchema.parse(
    await command(api, "start_checkout", {
      p_product_id: z.uuid().parse(productId),
      p_target_post: targetPostId === null ? null : z.uuid().parse(targetPostId),
    })
  );
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
  if (pay.checkout_url)
    return { paymentId: pay.id, checkoutUrl: checkoutRedirect(pay.checkout_url) };
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
 * completed payment (a Refunded status is recorded as late_status_ignored and
 * logged for staff below; refunds are handled by staff).
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

/** Refusals that may mean money moved without a matching delivery (a second
 * transaction on a payment, a wrong amount): logged as errors for staff. */
const NEEDS_STAFF: ReadonlySet<string> = new Set([
  "transaction_id_mismatch",
  "amount_mismatch",
  "currency_mismatch",
]);
/**
 * A correctly signed notice that can never be applied: logged with the payment
 * number and a reason code (no personal data) and acknowledged, so the sender
 * does not retry it for a day and switch the notice address off. The 10-minute
 * status check still settles a real payment from Ozow's own records.
 * Follow-up (M3.3): keep these in private.provider_events too (needs a reviewed
 * database update; apply_provider_event records only its own outcomes).
 */
function refuseOzowNotice(reason: string, paymentId: string | null) {
  (NEEDS_STAFF.has(reason) ? log.error : log.warn)("Ozow notice refused", { paymentId, reason });
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
  if (!pay) return refuseOzowNotice("unknown_payment", null);
  const refusal = validateOzowConfirmation(confirmationShape(pay), payload);
  if (refusal) {
    if (isRetryableConfirmationRefusal(refusal)) {
      log.warn("Ozow notice deferred", {
        paymentId: pay.id,
        reason: confirmationRefusalCode(refusal),
      });
      throw new FoundationBillingError(503, "Payment confirmation cannot be checked yet");
    }
    return refuseOzowNotice(confirmationRefusalCode(refusal), pay.id);
  }
  const outcome = await applyTransaction(service, pay, payload, rawBody);
  const recorded = (outcome as { outcome?: unknown } | null)?.outcome;
  if (
    recorded === "conflicting_transaction" ||
    (recorded === "late_status_ignored" && payload.status?.toLowerCase() === "refunded")
  )
    log.error("Ozow notice needs staff attention", { paymentId: pay.id, reason: recorded });
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

export async function reconcileFoundationPayment(
  paymentId: string,
  service = createFoundationServiceApi()
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
      log.warn("Ozow transaction refused by the status check", {
        paymentId: pay.id,
        reason: confirmationRefusalCode(refusal),
      });
      throw new FoundationBillingError(
        503,
        "Payment reconciliation did not match its stored quote"
      );
    }
  }
  const successful = transactions.filter(
    (transaction) => transaction.status?.toLowerCase() === "successful"
  );
  if (successful.length > 1)
    throw new FoundationBillingError(503, "Multiple payment settlements require reconciliation");
  if (successful.length === 1) {
    await applyTransaction(
      service,
      pay,
      successful[0],
      `reconciliation:${JSON.stringify(successful[0])}`
    );
    return { checked: true, pendingTransaction: false, settled: true };
  }
  const pending = transactions.some((transaction) =>
    ["pending", "incomplete"].includes(transaction.status?.toLowerCase() ?? "")
  );
  if (
    !pending &&
    pay.status === "pending" &&
    (await getOzowPaymentRequestStatus(pay.provider_request_id)) === "Expired"
  )
    await command(service, "finish_unpaid_checkout", { p_payment_id: pay.id, p_status: "expired" });
  return { checked: true, pendingTransaction: pending };
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
  // A mock checkout has no provider evidence to close it with: refuse.
  if (isMockCheckout(pay.provider_request_id)) throw new FoundationBillingError(409);
  await cancelOzowPaymentRequest(pay.provider_request_id);
  // A simultaneous settlement must win. The private row CAS and the provider
  // evidence both have to agree before the pending checkout is closed.
  const result = await reconcileFoundationPayment(pay.id, service);
  if (!result.checked || result.pendingTransaction || result.settled)
    throw new FoundationBillingError(409, "The bank transaction is still being checked");
  if (
    (await command(service, "finish_unpaid_checkout", {
      p_payment_id: pay.id,
      p_status: "cancelled",
    })) !== true
  )
    throw new FoundationBillingError(409, "The payment status changed; check it again");
  return { success: true };
}

export async function runFoundationPaymentReconciliation(service = createFoundationServiceApi()) {
  const payments = z
    .array(foundationPaymentSchema)
    .max(50)
    .parse(await command(service, "list_reconcilable_payments", { p_limit: 20 }));
  let checked = 0;
  let failures = 0;
  for (const pay of payments) {
    try {
      if ((await reconcileFoundationPayment(pay.id, service)).checked) checked++;
    } catch {
      failures++;
    }
  }
  return { checked, failures };
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
