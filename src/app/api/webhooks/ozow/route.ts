import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { fulfillPayment, rollbackPaymentProcessing } from "@/lib/payments/fulfillment";
import { normalizeOzowWebhook, verifyOzowWebhookSignature } from "@/lib/payments/ozow";
import {
  finalizeCompletedPayment,
  getPaymentById,
  hasFulfillmentCompletion,
  markPaymentFailed,
  persistFulfillmentCompletion,
  claimPaymentProcessing,
} from "@/lib/payments/store";

const log = createLogger("OzowWebhook");

function toAmountString(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

export async function POST(request: NextRequest) {
  try {
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

    const parsedBody = JSON.parse(rawBody) as unknown;
    const payload = normalizeOzowWebhook(parsedBody);
    if (!payload?.merchantReference) {
      return NextResponse.json({ error: "Missing merchantReference" }, { status: 400 });
    }

    const supabase = createAdminClient();
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
      const receivedCents = Math.round(parseFloat(payload.amount) * 100);
      if (!Number.isFinite(receivedCents) || receivedCents !== payment.amount_cents) {
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
      await markPaymentFailed(supabase, payment, payload.rawPayload);
      return NextResponse.json({ success: true });
    }

    if (eventType && eventType !== "transaction.complete") {
      return NextResponse.json({ success: true, ignored: true });
    }

    const claimed = await claimPaymentProcessing(supabase, payment, payload);

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

      if (hasFulfillmentCompletion(currentPayment)) {
        const finalized = await finalizeCompletedPayment(supabase, currentPayment, payload);
        if (!finalized) {
          return NextResponse.json({ error: "Payment finalization failed" }, { status: 500 });
        }

        return NextResponse.json({ success: true, recovered: true });
      }

      try {
        await fulfillPayment(supabase as never, {
          id: currentPayment.id,
          user_id: currentPayment.user_id,
          area: currentPayment.area as never,
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

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("Ozow webhook processing failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
