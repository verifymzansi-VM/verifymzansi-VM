import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { appendProviderWebhook } from "@/lib/payments/types";
import { fulfillPayment, rollbackPaymentProcessing } from "@/lib/payments/fulfillment";
import { normalizeOzowWebhook, verifyOzowWebhookSignature } from "@/lib/payments/ozow";

const log = createLogger("OzowWebhook");
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

function toAmountString(amountCents: number): string {
  return (amountCents / 100).toFixed(2);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-ozow-signature");
    const webhookSecret = process.env.OZOW_WEBHOOK_SECRET;
    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction && !webhookSecret) {
      return NextResponse.json({ error: "Ozow webhook temporarily unavailable" }, { status: 503 });
    }

    if (webhookSecret && !verifyOzowWebhookSignature(rawBody, signature)) {
      log.warn("Invalid Ozow webhook signature");
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    const parsedBody = JSON.parse(rawBody) as unknown;
    const payload = normalizeOzowWebhook(parsedBody);
    if (!payload?.merchantReference) {
      return NextResponse.json({ error: "Missing merchantReference" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: payment } = await supabase
      .from("payments")
      .select(
        "id, area, status, provider, provider_payment_id, provider_reference, provider_data, amount_cents, user_id"
      )
      .eq("id", payload.merchantReference)
      .maybeSingle();

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

    if (payload.amount && payload.amount !== toAmountString(payment.amount_cents)) {
      log.error("Ozow amount mismatch", {
        paymentId: payment.id,
        expected: toAmountString(payment.amount_cents),
        received: payload.amount,
      });
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    const eventType = payload.eventType?.toLowerCase() || "";
    if (
      payment.status === "complete" &&
      payment.provider_payment_id === payload.providerPaymentId
    ) {
      return NextResponse.json({ success: true, duplicate: true });
    }

    if (eventType.includes("cancel") || eventType.includes("fail")) {
      await supabase
        .from("payments")
        .update({
          status: "failed",
          provider_data: appendProviderWebhook(
            {
              id: payment.id,
              user_id: payment.user_id,
              area: payment.area,
              amount_cents: payment.amount_cents,
              status: payment.status,
              provider: "ozow",
              provider_payment_id: payment.provider_payment_id,
              provider_reference: payment.provider_reference,
              provider_data: (payment.provider_data as Record<string, unknown> | null) || null,
            },
            payload.rawPayload
          ),
        })
        .eq("id", payment.id)
        .eq("provider", "ozow");
      return NextResponse.json({ success: true });
    }

    if (eventType && eventType !== "transaction.complete") {
      return NextResponse.json({ success: true, ignored: true });
    }

    const { data: claimedRows } = await supabase
      .from("payments")
      .update({
        status: "processing",
        provider_payment_id: payload.providerPaymentId || payment.provider_payment_id,
      })
      .eq("id", payment.id)
      .eq("provider", "ozow")
      .neq("status", "complete")
      .neq("status", "processing")
      .select("id");

    if (!claimedRows?.length) {
      return NextResponse.json({ success: true, duplicate: true });
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

    await supabase
      .from("payments")
      .update({
        status: "complete",
        provider_payment_id: payload.providerPaymentId || payment.provider_payment_id,
        provider_reference: payment.provider_reference || payment.id,
        provider_data: appendProviderWebhook(
          {
            id: payment.id,
            user_id: payment.user_id,
            area: payment.area,
            amount_cents: payment.amount_cents,
            status: "processing",
            provider: "ozow",
            provider_payment_id: payload.providerPaymentId || payment.provider_payment_id,
            provider_reference: payment.provider_reference || payment.id,
            provider_data: (payment.provider_data as Record<string, unknown> | null) || null,
          },
          payload.rawPayload
        ),
      })
      .eq("id", payment.id)
      .eq("provider", "ozow");

    return NextResponse.json({
      success: true,
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
    });
  } catch (error) {
    log.error("Ozow webhook processing failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
