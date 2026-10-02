import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { scheduleBackgroundTask } from "@/lib/utils/background-task";
import { fulfillPayment, type FulfillmentResult } from "@/lib/payments/fulfillment";
import {
  fromOzowMerchantReference,
  getOzowTransaction,
  normalizeOzowWebhook,
  verifyOzowWebhookSignature,
} from "@/lib/payments/ozow";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { validateOzowConfirmation } from "@/lib/payments/confirmation";
import {
  getPaymentById,
  getPaymentByProviderReference,
  markPaymentFailed,
  type PaymentStoreClient,
} from "@/lib/payments/store";
import { auditPaymentCompleted, sendPaymentStatusEmail } from "@/lib/payments/notifications";
import { readBoundedRequestText, RequestBodyTooLargeError } from "@/lib/utils/request-body";

const log = createLogger("OzowWebhook");
const SUPPORTED_OZOW_EVENT_TYPE = "transaction.complete";
/** Payment states already closed on our side: never charged, or reversed. */
const TERMINAL_UNPAID_STATUSES: ReadonlySet<string> = new Set([
  "expired",
  "cancelled",
  "refunded",
  "chargeback",
]);

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

function isFailedTransactionStatus(status: string | null): boolean {
  return status?.toLowerCase() === "error";
}

function isSuccessfulTransactionStatus(status: string | null): boolean {
  return status?.toLowerCase() === "successful";
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

    let rawBody: string;
    try {
      rawBody = await readBoundedRequestText(request, 256 * 1024);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return NextResponse.json({ error: "Payload too large" }, { status: 413 });
      }
      throw error;
    }
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
    let payload = normalizeOzowWebhook(parsedBody);
    if (payload?.eventType?.toLowerCase() !== SUPPORTED_OZOW_EVENT_TYPE) {
      return NextResponse.json({ success: true, ignored: true });
    }
    if (payload.format === "thin" && payload.transactionId) {
      // Fetch authoritative reference, site, amount and current status. A lookup
      // failure returns 5xx so Svix retries rather than losing the completion.
      const thinPayload = payload.rawPayload;
      payload = await getOzowTransaction(payload.transactionId);
      payload.rawPayload = { ...thinPayload, resolvedTransaction: payload.rawPayload };
    }
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

    const validationError = validateOzowConfirmation(payment, payload);
    if (validationError) {
      log.error("Ozow confirmation rejected", { paymentId: payment.id, reason: validationError });
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const eventType = payload.eventType?.toLowerCase() || "";
    const status = payload.status?.toLowerCase() || "";
    if (
      payment.status === "complete" &&
      payment.provider_data?.transaction_id === payload.transactionId
    ) {
      return NextResponse.json({ success: true, duplicate: true });
    }

    if (eventType === SUPPORTED_OZOW_EVENT_TYPE && isFailedTransactionStatus(status)) {
      if (payment.status === "failed") {
        return NextResponse.json({ success: true, duplicate: true });
      }

      // Already closed on our side (checkout expired or cancelled, or money
      // returned): a provider failure changes nothing, and a 5xx here would
      // only make the provider retry for days.
      if (TERMINAL_UNPAID_STATUSES.has(payment.status)) {
        return NextResponse.json({ success: true, ignored: true });
      }

      // A claimed or terminal payment must never be downgraded by a late or
      // contradictory error webhook. The entitlements are already live; the
      // payment record must stay consistent with them.
      if (payment.status === "complete" || payment.status === "processing") {
        log.error("Ignoring failure webhook for a claimed or completed payment", {
          paymentId: payment.id,
          transactionId: payload.transactionId,
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
          currentPayment?.status === "processing" ||
          (currentPayment && TERMINAL_UNPAID_STATUSES.has(currentPayment.status))
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
            transactionId: payload.transactionId,
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
      if (eventType === SUPPORTED_OZOW_EVENT_TYPE) {
        log.info("Ozow transaction has no successful completion to fulfill", {
          paymentId: payment.id,
          transactionId: payload.transactionId,
          status,
        });
      }
      return NextResponse.json({ success: true, ignored: true });
    }

    if (!payload.transactionId) {
      return NextResponse.json({ error: "Missing payment ID" }, { status: 400 });
    }

    let result: FulfillmentResult;
    try {
      result = await fulfillPayment(supabase as never, payment, payload.rawPayload, {
        id: payload.transactionId,
        merchantReference: payload.merchantReference,
      });
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

    if (result.outcome === "ignored") {
      // Money was taken for a payment we will not fulfil (e.g. cancelled or
      // refunded on our side). It needs a refund or a manual grant.
      log.error("Successful Ozow payment was not fulfilled; needs reconciliation", {
        paymentId: payment.id,
        transactionId: payload.transactionId,
        paymentStatus: payment.status,
      });
      return NextResponse.json({ success: true, ignored: true });
    }

    if (result.outcome === "duplicate") {
      return NextResponse.json({ success: true, duplicate: true });
    }

    const completedPayment = payment;
    await auditPaymentCompleted(completedPayment);
    scheduleBackgroundTask(
      sendPaymentStatusEmail({
        admin: supabase,
        payment: completedPayment,
        status: "success",
        logContext: {
          paymentId: payment.id,
          transactionId: payload.transactionId,
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
