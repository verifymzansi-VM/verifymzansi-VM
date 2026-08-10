import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { fulfillPayment, rollbackPaymentProcessing } from "@/lib/payments/fulfillment";
import {
  fromOzowMerchantReference,
  normalizeOzowWebhook,
  verifyOzowWebhookSignature,
} from "@/lib/payments/ozow";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import {
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
} from "@/lib/constants/pricing";
import { getPaymentMetadata } from "@/lib/payments/types";
import {
  finalizeCompletedPayment,
  getPaymentById,
  getPaymentByProviderReference,
  hasFulfillmentCompletion,
  markPaymentFailed,
  persistFulfillmentCompletion,
  claimPaymentProcessing,
  type PaymentRow,
  type PaymentStoreClient,
} from "@/lib/payments/store";
import { logAuditEvent } from "@/lib/services/audit";
import {
  sendPaymentFailedEmail,
  sendPaymentReceiptEmail,
  type PaymentReceiptDetails,
} from "@/lib/services/email";
import { getAuthAdminUserSummary } from "@/lib/supabase/auth-admin-user";

const log = createLogger("OzowWebhook");
const SUPPORTED_OZOW_EVENT_TYPE = "transaction.complete";
const SUBSCRIPTION_DURATION_DAYS = 30;
/** Window in which a fresh "processing" claim is treated as in-flight, not stale. */
const IN_FLIGHT_DUPLICATE_WINDOW_MS = 60_000;

/**
 * Route ownership:
 * - Authenticity/idempotency: Ozow signature verification and payment-store claim helpers.
 * - Validation: normalized Ozow payload, merchant reference, amount, currency, and provider IDs.
 * - Fulfillment: payments/fulfillment owns entitlement creation and rollback recovery.
 * - Audit/notifications: this route owns receipt/failure email and payment audit side effects.
 */

function isE2eLoggingContext(): boolean {
  const runtimeMode = (process.env.VERIFYMZANSI_RUNTIME_MODE || "").toLowerCase();
  return (
    runtimeMode === "e2e" ||
    runtimeMode === "playwright" ||
    runtimeMode === "test" ||
    process.env.PLAYWRIGHT_E2E_AUTH === "1"
  );
}

const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

function getPlanNameFromArea(area?: string | null): string {
  switch (area) {
    case "MZANSI_MARKET":
      return "Mzansi Market";
    case "MZANSI_BUSINESS":
      return "Mzansi Business";
    case "PROMOTIONS_EVENTS":
      return "Tourism & Events";
    default:
      return "VerifyMzansi Plan";
  }
}

const ADDON_LABELS: Record<string, string> = {
  boost: "Listing Boost",
  boost_business: "Business Boost",
  boost_storefront: "Storefront Boost",
  boost_promotion: "Promotion Boost",
  featured: "Featured Listing",
  featured_business: "Featured Business",
  featured_promotion: "Featured Promotion",
  urgent: "Urgent Listing",
  urgent_business: "Urgent Business",
  urgent_promotion: "Urgent Promotion",
};

function getAddonDurationDays(type: string, meta: Record<string, unknown>): number {
  const specific =
    typeof meta.boost_days === "number" && meta.boost_days > 0
      ? meta.boost_days
      : typeof meta.feature_days === "number" && meta.feature_days > 0
        ? meta.feature_days
        : typeof meta.urgent_days === "number" && meta.urgent_days > 0
          ? meta.urgent_days
          : null;
  if (specific !== null) return specific;
  if (type.startsWith("featured")) return FEATURED_DURATION_DAYS;
  if (type.startsWith("urgent")) return URGENT_DURATION_DAYS;
  return BOOST_DURATION_DAYS;
}

/** Receipt wording differs for 30-day plans (no auto-renew) vs one-off add-ons. */
function buildReceiptDetails(payment: PaymentRow): PaymentReceiptDetails {
  const meta = getPaymentMetadata(payment);
  const type = typeof meta?.type === "string" ? meta.type : null;

  if (!type || type === "subscription") {
    // Mirrors the entitlement window set during fulfillment (payment + 30 days).
    return {
      kind: "subscription",
      expiresAt: new Date(
        Date.now() + SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000
      ).toISOString(),
    };
  }

  return {
    kind: "addon",
    addonName: ADDON_LABELS[type] ?? "Marketplace Add-on",
    durationDays: getAddonDurationDays(type, meta ?? {}),
  };
}

async function sendPaymentStatusEmail(params: {
  admin: PaymentStoreClient;
  payment: PaymentRow;
  status: "success" | "failed";
  logContext: { paymentId: string; providerPaymentId?: string | null };
}): Promise<void> {
  const recipient = await getAuthAdminUserSummary(params.admin, params.payment.user_id);
  if (recipient.errorMessage || !recipient.email) {
    log.warn("Skipping payment email: recipient lookup failed", {
      ...params.logContext,
      userId: params.payment.user_id,
      error: recipient.errorMessage,
    });
    return;
  }

  const email = recipient.email;
  const accountName = recipient.accountName;
  const amount = params.payment.amount_cents / 100;
  const planName = getPlanNameFromArea(params.payment.area);

  const result =
    params.status === "success"
      ? await sendPaymentReceiptEmail(
          email,
          accountName,
          amount,
          planName,
          undefined,
          buildReceiptDetails(params.payment)
        )
      : await sendPaymentFailedEmail(email, accountName, amount, planName);

  if (!result.success) {
    log.warn("Payment email delivery failed", {
      ...params.logContext,
      userId: params.payment.user_id,
      status: params.status,
      error: result.error,
    });
  }

  try {
    await logAuditEvent({
      actorId: SYSTEM_ACTOR_ID,
      actorRole: "system",
      action: result.success ? "communication_email_sent" : "communication_email_failed",
      targetType: "account_profile",
      targetId: params.payment.user_id,
      metadata: {
        template: params.status === "success" ? "payment_receipt" : "payment_failed",
        channel: "email",
        error: result.error,
        owner_user_id: params.payment.user_id,
        payment_id: params.logContext.paymentId,
        provider_payment_id: params.logContext.providerPaymentId,
      },
    });
  } catch (auditErr) {
    log.error("Audit log failed (non-fatal)", {
      error: auditErr instanceof Error ? auditErr.message : "Unknown",
    });
  }
}

/** Non-blocking audit log for completed payments. */
async function auditPaymentCompleted(payment: {
  id: string;
  provider: string;
  amount_cents: number;
  provider_payment_id?: string | null;
  area?: string | null;
}): Promise<void> {
  try {
    await logAuditEvent({
      actorId: SYSTEM_ACTOR_ID,
      actorRole: "system",
      action: "payment_completed",
      targetType: "payment",
      targetId: payment.id,
      metadata: {
        provider: payment.provider,
        amount_cents: payment.amount_cents,
        provider_payment_id: payment.provider_payment_id,
        area: payment.area,
      },
    });
  } catch (auditErr) {
    log.error("Failed to write payment audit log", {
      paymentId: payment.id,
      error: auditErr instanceof Error ? auditErr.message : "Unknown error",
    });
  }
}

function toAmountString(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

function isFailedTransactionStatus(status: string | null): boolean {
  return status?.toLowerCase() === "error";
}

function isSuccessfulTransactionStatus(status: string | null): boolean {
  return status?.toLowerCase() === "successful";
}

/** Milliseconds timestamp of the current processing claim, or null if unknown. */
function getProcessingStartedAtMs(payment: PaymentRow): number | null {
  const startedAt = payment.provider_data?.processing_started_at;
  if (typeof startedAt !== "string") return null;
  const ms = Date.parse(startedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse a decimal amount string (e.g. "1000.00") to integer cents
 * without using floating-point multiplication.
 *
 * Returns null if the input is not a valid non-negative decimal number.
 */
function parseAmountToCents(amount: string): number | null {
  const trimmed = amount.trim();
  // Match optional digits, optional dot with up to 2 decimal places
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  const cents = parseInt(whole, 10) * 100 + parseInt(frac.padEnd(2, "0"), 10);
  return Number.isFinite(cents) && cents >= 0 ? cents : null;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit webhook by IP to prevent flood attacks
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "webhook:ozow",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const rawBody = await request.text();
    const webhookSecret = process.env.OZOW_WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (!webhookSecret) {
      if (isProduction) {
        return NextResponse.json(
          { error: "Ozow webhook temporarily unavailable" },
          { status: 503 }
        );
      }
      log.warn("OZOW_WEBHOOK_SECRET is not set — rejecting unsigned webhook in non-production");
      return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
    }

    if (!verifyOzowWebhookSignature(rawBody, request.headers)) {
      if (isE2eLoggingContext()) {
        log.info("Invalid Ozow webhook signature");
      } else {
        log.warn("Invalid Ozow webhook signature");
      }
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch (error) {
      log.warn("Ozow webhook JSON parse failed", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const payload = normalizeOzowWebhook(parsedBody);
    if (!payload?.merchantReference) {
      return NextResponse.json({ error: "Missing merchantReference" }, { status: 400 });
    }
    if (payload.eventType?.toLowerCase() === SUPPORTED_OZOW_EVENT_TYPE && !payload.status) {
      return NextResponse.json({ error: "Missing transaction status" }, { status: 400 });
    }

    const supabase = createAdminClient() as unknown as PaymentStoreClient;
    const reconstructedId = fromOzowMerchantReference(payload.merchantReference);
    const payment =
      (await getPaymentByProviderReference(supabase, payload.merchantReference)) ||
      (reconstructedId
        ? await getPaymentById(supabase, reconstructedId)
        : await getPaymentById(supabase, payload.merchantReference));

    if (!payment) {
      log.warn("Ozow webhook payment not found", { merchantReference: payload.merchantReference });
      return NextResponse.json({ success: true, ignored: true });
    }

    if (payment.provider !== "ozow") {
      log.info("Ignoring Ozow webhook for non-Ozow payment", {
        paymentId: payment.id,
        provider: payment.provider,
      });
      return NextResponse.json({ success: true, ignored: true });
    }

    if (payload.currencyCode && payload.currencyCode.toUpperCase() !== "ZAR") {
      log.error("Ozow currency mismatch", {
        paymentId: payment.id,
        expected: "ZAR",
        received: payload.currencyCode,
      });
      return NextResponse.json({ error: "Currency mismatch" }, { status: 400 });
    }

    const eventType = payload.eventType?.toLowerCase() || "";
    const status = payload.status?.toLowerCase() || "";

    // Defense-in-depth for the money-critical completion path: a successful
    // transaction.complete webhook MUST carry an amount. Skipping validation when
    // the field is absent would let a malformed (but signed) payload fulfill
    // against the stored amount without ever confirming what was actually charged.
    if (
      eventType === SUPPORTED_OZOW_EVENT_TYPE &&
      isSuccessfulTransactionStatus(status) &&
      !payload.amount
    ) {
      log.error("Ozow successful completion webhook missing amount", {
        paymentId: payment.id,
        eventType: payload.eventType,
        status: payload.status,
      });
      return NextResponse.json({ error: "Missing amount" }, { status: 400 });
    }

    if (payload.amount) {
      // Parse amount string as integer cents without floating-point arithmetic
      // to avoid precision errors (e.g. "1000.009" * 100 = 100000.899...)
      const receivedCents = parseAmountToCents(payload.amount);
      if (receivedCents === null || receivedCents !== payment.amount_cents) {
        log.error("Ozow amount mismatch", {
          paymentId: payment.id,
          expected: toAmountString(payment.amount_cents),
          received: payload.amount,
        });
        return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
      }
    }
    if (
      payment.status === "complete" &&
      payment.provider_payment_id === payload.providerPaymentId
    ) {
      return NextResponse.json({ success: true, duplicate: true });
    }

    // Reject webhooks whose providerPaymentId contradicts the stored value
    if (
      payment.provider_payment_id &&
      payload.providerPaymentId &&
      payment.provider_payment_id !== payload.providerPaymentId
    ) {
      log.error("providerPaymentId mismatch — possible replay/substitution", {
        paymentId: payment.id,
        stored: payment.provider_payment_id,
        received: payload.providerPaymentId,
      });
      return NextResponse.json({ error: "Payment ID mismatch" }, { status: 400 });
    }

    if (eventType === SUPPORTED_OZOW_EVENT_TYPE && isFailedTransactionStatus(status)) {
      if (payment.status === "failed") {
        return NextResponse.json({ success: true, duplicate: true });
      }

      // A terminal "complete" payment must never be downgraded by a late or
      // contradictory error webhook. The entitlements are already live; the
      // payment record must stay consistent with them.
      if (payment.status === "complete") {
        log.error("Ignoring failure webhook for an already-completed payment", {
          paymentId: payment.id,
          providerPaymentId: payload.providerPaymentId,
        });
        return NextResponse.json({ success: true, ignored: true });
      }

      const marked = await markPaymentFailed(supabase, payment, payload.rawPayload);
      if (!marked) {
        // Either a DB error, or a concurrent webhook transitioned the payment
        // (e.g. completed it) between our read and the CAS-guarded update.
        const currentPayment = await getPaymentById(supabase, payment.id);
        if (currentPayment?.status === "complete" || currentPayment?.status === "failed") {
          log.info("Failure webhook superseded by concurrent payment transition", {
            paymentId: payment.id,
            currentStatus: currentPayment.status,
          });
          return NextResponse.json({ success: true, duplicate: true });
        }

        log.error("Failed to mark payment as failed", { paymentId: payment.id });
        return NextResponse.json(
          { error: "Payment status update failed" },
          { status: 500, headers: { "Retry-After": "30" } }
        );
      }

      sendPaymentStatusEmail({
        admin: supabase,
        payment,
        status: "failed",
        logContext: {
          paymentId: payment.id,
          providerPaymentId: payload.providerPaymentId,
        },
      }).catch((emailErr) => {
        log.warn("Failed to queue payment failed email", {
          paymentId: payment.id,
          error: emailErr instanceof Error ? emailErr.message : "Unknown error",
        });
      });

      return NextResponse.json({ success: true });
    }

    // Only a successful transaction completion may claim and fulfil a payment.
    // Payloads with a missing/unsupported event type or a missing/non-success
    // status must never reach fulfillment — they are acknowledged and ignored.
    if (eventType !== SUPPORTED_OZOW_EVENT_TYPE || !isSuccessfulTransactionStatus(status)) {
      return NextResponse.json({ success: true, ignored: true });
    }

    const claimed = await claimPaymentProcessing(supabase, payment, payload);

    // Double-fulfillment guard: after claiming, re-read the payment to verify
    // we truly own the processing state. This closes the TOCTOU window where
    // two concurrent webhooks could both pass claimPaymentProcessing().
    if (claimed) {
      const claimedPayment = await getPaymentById(supabase, payment.id);
      if (
        !claimedPayment ||
        claimedPayment.status !== "processing" ||
        hasFulfillmentCompletion(claimedPayment)
      ) {
        log.info("Payment was already fulfilled by a concurrent request", {
          paymentId: payment.id,
        });
        return NextResponse.json({ success: true, duplicate: true });
      }
    }

    if (!claimed) {
      log.info("Webhook claim failed — entering recovery path", {
        paymentId: payment.id,
        originalStatus: payment.status,
      });
      const currentPayment = await getPaymentById(supabase, payment.id);

      if (!currentPayment) {
        log.error("RECOVERY: Payment disappeared after claim failure", { paymentId: payment.id });
        return NextResponse.json({ error: "Payment not found" }, { status: 404 });
      }

      if (
        currentPayment.status === "complete" &&
        currentPayment.provider_payment_id === payload.providerPaymentId
      ) {
        log.info("RECOVERY: Payment already complete — duplicate webhook", {
          paymentId: payment.id,
        });
        return NextResponse.json({ success: true, duplicate: true });
      }

      if (currentPayment.status !== "processing") {
        return NextResponse.json({ success: true, duplicate: true });
      }

      // Re-validate amount against the recovered payment record to prevent
      // a stale webhook from fulfilling with mismatched amounts. A successful
      // completion must always carry an amount — never skip validation.
      if (!payload.amount) {
        log.error("Ozow recovery successful completion missing amount", {
          paymentId: currentPayment.id,
        });
        return NextResponse.json({ error: "Missing amount" }, { status: 400 });
      }
      const recoveryCents = parseAmountToCents(payload.amount);
      if (recoveryCents === null || recoveryCents !== currentPayment.amount_cents) {
        log.error("Ozow recovery amount mismatch", {
          paymentId: currentPayment.id,
          expected: toAmountString(currentPayment.amount_cents),
          received: payload.amount,
        });
        return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
      }

      if (hasFulfillmentCompletion(currentPayment)) {
        const finalized = await finalizeCompletedPayment(supabase, currentPayment, payload);
        if (!finalized) {
          return NextResponse.json(
            { error: "Payment finalization failed" },
            { status: 500, headers: { "Retry-After": "30" } }
          );
        }

        await auditPaymentCompleted(currentPayment);

        sendPaymentStatusEmail({
          admin: supabase,
          payment: currentPayment,
          status: "success",
          logContext: {
            paymentId: currentPayment.id,
            providerPaymentId: payload.providerPaymentId,
          },
        }).catch((emailErr) => {
          log.warn("Failed to queue payment receipt email", {
            paymentId: currentPayment.id,
            error: emailErr instanceof Error ? emailErr.message : "Unknown error",
          });
        });

        return NextResponse.json({ success: true, recovered: true });
      }

      // In-flight duplicate guard: the claim owner is still mid-fulfillPayment
      // (fresh processing_started_at, no fulfillment marker yet). Treat this
      // delivery as a duplicate instead of fulfilling a second time; rows with
      // a stale or missing timestamp fall through to the recovery fulfillment.
      const processingStartedAtMs = getProcessingStartedAtMs(currentPayment);
      if (
        processingStartedAtMs !== null &&
        Date.now() - processingStartedAtMs < IN_FLIGHT_DUPLICATE_WINDOW_MS
      ) {
        log.info("RECOVERY: Payment is being fulfilled by a concurrent webhook — duplicate", {
          paymentId: currentPayment.id,
        });
        return NextResponse.json({ success: true, duplicate: true });
      }

      try {
        await fulfillPayment(supabase as never, {
          id: currentPayment.id,
          user_id: currentPayment.user_id,
          area: currentPayment.area,
          amount_cents: currentPayment.amount_cents,
          status: "processing",
          provider: "ozow",
          provider_payment_id: payload.providerPaymentId || currentPayment.provider_payment_id,
          provider_reference: currentPayment.provider_reference || currentPayment.id,
          provider_data: currentPayment.provider_data,
        });
      } catch (error) {
        log.error("Ozow recovery fulfillment failed", {
          paymentId: currentPayment.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return NextResponse.json(
          { error: "Payment fulfillment failed" },
          { status: 500, headers: { "Retry-After": "30" } }
        );
      }

      const marked = await persistFulfillmentCompletion(supabase, currentPayment, payload);
      if (!marked) {
        log.error(
          "CRITICAL: Recovery fulfillment completed but completion marker failed — manual review required",
          {
            paymentId: currentPayment.id,
            userId: currentPayment.user_id,
            area: currentPayment.area,
            entitlementsMayBeActive: true,
          }
        );
      }

      const reloadedPayment = await getPaymentById(supabase, currentPayment.id);
      if (!reloadedPayment) {
        return NextResponse.json(
          { error: "Payment finalization failed" },
          { status: 500, headers: { "Retry-After": "30" } }
        );
      }

      const finalized = await finalizeCompletedPayment(supabase, reloadedPayment, payload);
      if (!finalized) {
        return NextResponse.json(
          { error: "Payment finalization failed" },
          { status: 500, headers: { "Retry-After": "30" } }
        );
      }

      await auditPaymentCompleted(reloadedPayment);

      sendPaymentStatusEmail({
        admin: supabase,
        payment: reloadedPayment,
        status: "success",
        logContext: {
          paymentId: reloadedPayment.id,
          providerPaymentId: payload.providerPaymentId,
        },
      }).catch((emailErr) => {
        log.warn("Failed to queue payment receipt email", {
          paymentId: reloadedPayment.id,
          error: emailErr instanceof Error ? emailErr.message : "Unknown error",
        });
      });

      return NextResponse.json({ success: true, recovered: true });
    }

    try {
      await fulfillPayment(supabase as never, {
        id: payment.id,
        user_id: payment.user_id,
        area: payment.area,
        amount_cents: payment.amount_cents,
        status: "processing",
        provider: "ozow",
        provider_payment_id: payload.providerPaymentId || payment.provider_payment_id,
        provider_reference: payment.provider_reference || payment.id,
        provider_data: (payment.provider_data as Record<string, unknown> | null) || null,
      });
    } catch (error) {
      log.error("Ozow fulfillment failed", {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      await rollbackPaymentProcessing(supabase as never, payment.id);
      return NextResponse.json(
        { error: "Payment fulfillment failed" },
        { status: 500, headers: { "Retry-After": "30" } }
      );
    }

    const processingPayment = await getPaymentById(supabase, payment.id);
    if (!processingPayment) {
      return NextResponse.json(
        { error: "Payment finalization failed" },
        { status: 500, headers: { "Retry-After": "30" } }
      );
    }

    const marked = await persistFulfillmentCompletion(supabase, processingPayment, payload);
    if (!marked) {
      // Fulfillment already succeeded (entitlements created) but the completion
      // marker could not be persisted. Log a critical alert for manual reconciliation
      // and return success so Ozow does not retry — the user has their features.
      log.error(
        "CRITICAL: Fulfillment completed but completion marker failed — manual review required",
        {
          paymentId: payment.id,
          userId: payment.user_id,
          area: payment.area,
          entitlementsMayBeActive: true,
        }
      );
    }

    const finalPayment = await getPaymentById(supabase, payment.id);
    if (!finalPayment) {
      return NextResponse.json(
        { error: "Payment finalization failed" },
        { status: 500, headers: { "Retry-After": "30" } }
      );
    }

    const finalized = await finalizeCompletedPayment(supabase, finalPayment, payload);
    if (!finalized) {
      return NextResponse.json(
        { error: "Payment finalization failed" },
        { status: 500, headers: { "Retry-After": "30" } }
      );
    }

    await auditPaymentCompleted(finalPayment);

    sendPaymentStatusEmail({
      admin: supabase,
      payment: finalPayment,
      status: "success",
      logContext: {
        paymentId: finalPayment.id,
        providerPaymentId: payload.providerPaymentId,
      },
    }).catch((emailErr) => {
      log.warn("Failed to queue payment receipt email", {
        paymentId: finalPayment.id,
        error: emailErr instanceof Error ? emailErr.message : "Unknown error",
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Ozow webhook processing failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500, headers: { "Retry-After": "30" } }
    );
  }
}
