import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { fulfillPayment, rollbackPaymentProcessing } from "@/lib/payments/fulfillment";
import { normalizeOzowWebhook, verifyOzowWebhookSignature } from "@/lib/payments/ozow";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import {
  finalizeCompletedPayment,
  getPaymentById,
  hasFulfillmentCompletion,
  markPaymentFailed,
  persistFulfillmentCompletion,
  claimPaymentProcessing,
  type PaymentStoreClient,
} from "@/lib/payments/store";
import { logAuditEvent } from "@/lib/services/audit";
import { sendPaymentFailedEmail, sendPaymentReceiptEmail } from "@/lib/services/email";

const log = createLogger("OzowWebhook");

const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

function getPlanNameFromArea(area?: string | null): string {
  switch (area) {
    case "MZANSI_MARKET":
      return "Mzansi Market";
    case "MZANSI_BUSINESS":
      return "Mzansi Business";
    case "PROMOTIONS_EVENTS":
      return "Promotions & Events";
    default:
      return "VerifyMzansi Plan";
  }
}

async function sendPaymentStatusEmail(params: {
  admin: PaymentStoreClient;
  userId: string;
  amountCents: number;
  area?: string | null;
  status: "success" | "failed";
  logContext: { paymentId: string; providerPaymentId?: string | null };
}): Promise<void> {
  const authAdmin = (
    params.admin as unknown as {
      auth?: {
        admin?: {
          getUserById?: (id: string) => Promise<{
            data?: {
              user?: {
                email?: string | null;
                user_metadata?: { full_name?: string | null; name?: string | null };
              } | null;
            };
            error?: { message?: string };
          }>;
        };
      };
    }
  ).auth?.admin;

  if (!authAdmin?.getUserById) return;

  const { data: userData, error: userLookupErr } = await authAdmin.getUserById(params.userId);
  const recipient = userData?.user;
  if (userLookupErr || !recipient?.email) {
    log.warn("Skipping payment email: recipient lookup failed", {
      ...params.logContext,
      userId: params.userId,
      error: userLookupErr?.message,
    });
    return;
  }

  const email = recipient.email;
  const accountName =
    recipient.user_metadata?.full_name || recipient.user_metadata?.name || "there";
  const amount = params.amountCents / 100;
  const planName = getPlanNameFromArea(params.area);

  const result =
    params.status === "success"
      ? await sendPaymentReceiptEmail(email, accountName, amount, planName)
      : await sendPaymentFailedEmail(email, accountName, amount, planName);

  if (!result.success) {
    log.warn("Payment email delivery failed", {
      ...params.logContext,
      userId: params.userId,
      status: params.status,
      error: result.error,
    });
  }

  await logAuditEvent({
    actorId: SYSTEM_ACTOR_ID,
    actorRole: "system",
    action: result.success ? "communication_email_sent" : "communication_email_failed",
    targetType: "account_profile",
    targetId: params.userId,
    metadata: {
      template: params.status === "success" ? "payment_receipt" : "payment_failed",
      channel: "email",
      error: result.error,
      owner_user_id: params.userId,
      payment_id: params.logContext.paymentId,
      provider_payment_id: params.logContext.providerPaymentId,
    },
  });
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
        provider_payment_id: payment.provider_payment_id ?? undefined,
        area: payment.area ?? undefined,
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
    const signature = request.headers.get("x-ozow-signature");
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

    if (!verifyOzowWebhookSignature(rawBody, signature)) {
      log.warn("Invalid Ozow webhook signature");
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody) as unknown;
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const payload = normalizeOzowWebhook(parsedBody);
    if (!payload?.merchantReference) {
      return NextResponse.json({ error: "Missing merchantReference" }, { status: 400 });
    }

    const supabase = createAdminClient() as unknown as PaymentStoreClient;
    const payment = await getPaymentById(supabase, payload.merchantReference);

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

    if (payload.currencyCode && payload.currencyCode !== "ZAR") {
      log.error("Ozow currency mismatch", {
        paymentId: payment.id,
        expected: "ZAR",
        received: payload.currencyCode,
      });
      return NextResponse.json({ error: "Currency mismatch" }, { status: 400 });
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

    const eventType = payload.eventType?.toLowerCase() || "";
    if (
      payment.status === "complete" &&
      payment.provider_payment_id === payload.providerPaymentId
    ) {
      return NextResponse.json({ success: true, duplicate: true });
    }

    if (eventType.includes("cancel") || eventType.includes("fail")) {
      if (payment.status === "failed") {
        return NextResponse.json({ success: true, duplicate: true });
      }

      await markPaymentFailed(supabase, payment, payload.rawPayload);

      sendPaymentStatusEmail({
        admin: supabase,
        userId: payment.user_id,
        amountCents: payment.amount_cents,
        area: payment.area,
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

    if (eventType && eventType !== "transaction.complete") {
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
      const currentPayment = await getPaymentById(supabase, payment.id);

      if (
        currentPayment?.status === "complete" &&
        currentPayment.provider_payment_id === payload.providerPaymentId
      ) {
        return NextResponse.json({ success: true, duplicate: true });
      }

      if (currentPayment?.status !== "processing") {
        return NextResponse.json({ success: true, duplicate: true });
      }

      // Re-validate amount against the recovered payment record to prevent
      // a stale webhook from fulfilling with mismatched amounts.
      if (payload.amount) {
        const recoveryCents = parseAmountToCents(payload.amount);
        if (recoveryCents === null || recoveryCents !== currentPayment.amount_cents) {
          log.error("Ozow recovery amount mismatch", {
            paymentId: currentPayment.id,
            expected: toAmountString(currentPayment.amount_cents),
            received: payload.amount,
          });
          return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
        }
      }

      if (hasFulfillmentCompletion(currentPayment)) {
        const finalized = await finalizeCompletedPayment(supabase, currentPayment, payload);
        if (!finalized) {
          return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
        }

        await auditPaymentCompleted(currentPayment);

        sendPaymentStatusEmail({
          admin: supabase,
          userId: currentPayment.user_id,
          amountCents: currentPayment.amount_cents,
          area: currentPayment.area,
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
        return NextResponse.json({ error: "Payment fulfillment failed" }, { status: 500 });
      }

      const marked = await persistFulfillmentCompletion(supabase, currentPayment, payload);
      if (!marked) {
        return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
      }

      const reloadedPayment = await getPaymentById(supabase, currentPayment.id);
      if (!reloadedPayment) {
        return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
      }

      const finalized = await finalizeCompletedPayment(supabase, reloadedPayment, payload);
      if (!finalized) {
        return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
      }

      await auditPaymentCompleted(reloadedPayment);

      sendPaymentStatusEmail({
        admin: supabase,
        userId: reloadedPayment.user_id,
        amountCents: reloadedPayment.amount_cents,
        area: reloadedPayment.area,
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
      return NextResponse.json({ error: "Payment fulfillment failed" }, { status: 500 });
    }

    const processingPayment = await getPaymentById(supabase, payment.id);
    if (!processingPayment) {
      return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
    }

    const marked = await persistFulfillmentCompletion(supabase, processingPayment, payload);
    if (!marked) {
      return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
    }

    const finalPayment = await getPaymentById(supabase, payment.id);
    if (!finalPayment) {
      return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
    }

    const finalized = await finalizeCompletedPayment(supabase, finalPayment, payload);
    if (!finalized) {
      return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
    }

    await auditPaymentCompleted(finalPayment);

    sendPaymentStatusEmail({
      admin: supabase,
      userId: finalPayment.user_id,
      amountCents: finalPayment.amount_cents,
      area: finalPayment.area,
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
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
