import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";
import { fulfillPayment, type FulfillmentResult } from "@/lib/payments/fulfillment";
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
  getPaymentById,
  getPaymentByProviderReference,
  markPaymentFailed,
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

/**
 * Route ownership:
 * - Authenticity/idempotency: Ozow signature verification and the atomic payment RPC.
 * - Validation: normalized Ozow payload, merchant reference, amount, currency, and provider IDs.
 * - Fulfillment: payments/fulfillment owns atomic entitlement/invoice writes and payment completion.
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
        (payment.created_at ? Date.parse(payment.created_at) : Date.now()) +
          SUBSCRIPTION_DURATION_DAYS * 24 * 60 * 60 * 1000
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

      // A claimed or terminal payment must never be downgraded by a late or
      // contradictory error webhook. The entitlements are already live; the
      // payment record must stay consistent with them.
      if (payment.status === "complete" || payment.status === "processing") {
        log.error("Ignoring failure webhook for a claimed or completed payment", {
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
        if (
          currentPayment?.status === "complete" ||
          currentPayment?.status === "failed" ||
          currentPayment?.status === "processing"
        ) {
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

      scheduleBackgroundTask(
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
        }),
        "payment status email"
      );

      return NextResponse.json({ success: true });
    }

    // Only a successful transaction completion may claim and fulfil a payment.
    // Payloads with a missing/unsupported event type or a missing/non-success
    // status must never reach fulfillment — they are acknowledged and ignored.
    if (eventType !== SUPPORTED_OZOW_EVENT_TYPE || !isSuccessfulTransactionStatus(status)) {
      return NextResponse.json({ success: true, ignored: true });
    }

    if (!payload.providerPaymentId) {
      return NextResponse.json({ error: "Missing payment ID" }, { status: 400 });
    }

    let result: FulfillmentResult;
    try {
      result = await fulfillPayment(
        supabase as never,
        { ...payment, provider_payment_id: payload.providerPaymentId },
        payload.rawPayload
      );
    } catch (error) {
      // The RPC either committed everything or rolled everything back. A lost
      // response is also safe to retry: the locked payment is already complete.
      log.error("Ozow atomic fulfillment failed", {
        paymentId: payment.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      return NextResponse.json(
        { error: "Payment fulfillment failed" },
        { status: 500, headers: { "Retry-After": "30" } }
      );
    }

    if (result.outcome === "duplicate" || result.outcome === "ignored") {
      return NextResponse.json({ success: true, [result.outcome]: true });
    }

    const completedPayment = { ...payment, provider_payment_id: payload.providerPaymentId };
    await auditPaymentCompleted(completedPayment);
    scheduleBackgroundTask(
      sendPaymentStatusEmail({
        admin: supabase,
        payment: completedPayment,
        status: "success",
        logContext: {
          paymentId: payment.id,
          providerPaymentId: payload.providerPaymentId,
        },
      }).catch((emailErr) => {
        log.warn("Failed to queue payment receipt email", {
          paymentId: payment.id,
          error: emailErr instanceof Error ? emailErr.message : "Unknown error",
        });
      }),
      "payment status email"
    );

    return NextResponse.json({
      success: true,
      ...(result.outcome === "recovered" ? { recovered: true } : {}),
    });
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
