import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPayFastSignature, isPayFastIp } from "@/lib/services/payfast";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import { appendProviderWebhook } from "@/lib/payments/types";
import { fulfillPayment, rollbackPaymentProcessing } from "@/lib/payments/fulfillment";

const log = createLogger("PayFastWebhook");
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * PayFast ITN (Instant Transaction Notification) webhook handler.
 * This endpoint is called by PayFast when a payment status changes.
 * Same-origin mutation enforcement is intentionally not applied here because
 * PayFast calls this endpoint server-to-server, not from the browser.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const params = new URLSearchParams(body);
    const data = Object.fromEntries(params.entries());

    // Verify source IP is from PayFast.
    // In production, only trust cf-connecting-ip (set by Cloudflare, not spoofable).
    // In development, fall back to x-forwarded-for for local testing.
    const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
    let sourceIp: string;
    if (process.env.NODE_ENV === "production") {
      sourceIp = cfConnectingIp || "";
      if (!sourceIp) {
        log.warn("PayFast webhook missing cf-connecting-ip in production");
        return NextResponse.json({ error: "Invalid source" }, { status: 403 });
      }
    } else {
      const forwardedFor = request.headers.get("x-forwarded-for");
      sourceIp = cfConnectingIp || forwardedFor?.split(",")[0].trim() || "";
    }

    if (!isPayFastIp(sourceIp)) {
      log.warn("Webhook from invalid IP", { sourceIp });
      return NextResponse.json({ error: "Invalid source IP" }, { status: 403 });
    }

    // Verify PayFast signature
    const passphrase = env("PAYFAST_PASSPHRASE");
    if (!verifyPayFastSignature(data, passphrase)) {
      log.warn("Webhook signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const paymentStatus = data.payment_status;
    const mPaymentId = data.m_payment_id; // Our internal payment ID
    const pfPaymentId = data.pf_payment_id; // PayFast payment ID
    const amountGross = parseFloat(data.amount_gross || "0");

    if (!mPaymentId) {
      return NextResponse.json({ error: "Missing payment ID" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // ── Idempotency check: reject duplicate webhook deliveries ──
    const { data: existingPayment } = await supabase
      .from("payments")
      .select(
        "id, area, status, provider, provider_payment_id, provider_reference, provider_data, payfast_payment_id, amount_cents, user_id, payfast_data"
      )
      .eq("id", mPaymentId)
      .maybeSingle();

    if (!existingPayment) {
      log.error("Payment not found", { paymentId: mPaymentId });
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (existingPayment.provider && existingPayment.provider !== "payfast") {
      log.info("Ignoring PayFast webhook for non-PayFast payment", {
        paymentId: mPaymentId,
        provider: existingPayment.provider,
      });
      return NextResponse.json({ success: true, ignored: true });
    }

    if (
      existingPayment.payfast_payment_id === pfPaymentId &&
      existingPayment.status === "complete"
    ) {
      // Already processed — return 200 so PayFast stops retrying
      return NextResponse.json({ success: true, duplicate: true });
    }

    // Verify payment amount matches expected (allow 1 cent variance for rounding)
    const expectedRands = existingPayment.amount_cents / 100;
    if (Math.abs(expectedRands - amountGross) > 0.01) {
      log.error("Payment amount mismatch", { expected: expectedRands, received: amountGross });
      return NextResponse.json({ error: "Amount mismatch" }, { status: 400 });
    }

    if (paymentStatus === "COMPLETE") {
      // CAS guard: claim ownership for processing. If another concurrent
      // request wins the race, this returns no rows and we bail.
      const { data: claimedRows } = await supabase
        .from("payments")
        .update({
          status: "processing",
          provider: "payfast",
          provider_payment_id: pfPaymentId,
          provider_reference: existingPayment.provider_reference || mPaymentId,
          payfast_payment_id: pfPaymentId,
        })
        .eq("id", mPaymentId)
        .neq("status", "complete")
        .neq("status", "processing")
        .neq("provider", "ozow")
        .select("id");

      if (!claimedRows?.length) {
        log.info("Duplicate ITN ignored (payment already claimed/complete)", {
          paymentId: mPaymentId,
        });
        return NextResponse.json({ success: true, duplicate: true });
      }

      try {
        await fulfillPayment(supabase as never, {
          id: existingPayment.id,
          user_id: existingPayment.user_id,
          area: existingPayment.area,
          amount_cents: existingPayment.amount_cents,
          status: "processing",
          provider: "payfast",
          provider_payment_id: pfPaymentId,
          provider_reference: existingPayment.provider_reference || mPaymentId,
          provider_data: (existingPayment.provider_data as Record<string, unknown> | null) || null,
          payfast_payment_id: existingPayment.payfast_payment_id,
          payfast_data: (existingPayment.payfast_data as Record<string, unknown> | null) || null,
        });
      } catch (error) {
        log.error("Legacy PayFast fulfillment failed", {
          paymentId: mPaymentId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        await rollbackPaymentProcessing(supabase as never, mPaymentId);
        return NextResponse.json({ error: "Payment fulfillment failed" }, { status: 500 });
      }

      // ── All processing succeeded — finalize payment status ──
      const existingMeta = (existingPayment.payfast_data as Record<string, unknown> | null) || {};
      const mergedProviderData = appendProviderWebhook(
        {
          id: existingPayment.id,
          user_id: existingPayment.user_id,
          area: existingPayment.area,
          amount_cents: existingPayment.amount_cents,
          status: "processing",
          provider: "payfast",
          provider_payment_id: pfPaymentId,
          provider_reference: existingPayment.provider_reference || mPaymentId,
          provider_data: (existingPayment.provider_data as Record<string, unknown> | null) || null,
          payfast_payment_id: existingPayment.payfast_payment_id,
          payfast_data: existingMeta,
        },
        data
      );
      await supabase
        .from("payments")
        .update({
          status: "complete",
          provider: "payfast",
          provider_payment_id: pfPaymentId,
          provider_reference: existingPayment.provider_reference || mPaymentId,
          provider_data: mergedProviderData,
          payfast_data: { ...existingMeta, itn: data },
        })
        .eq("id", mPaymentId);

      // Log to audit
      if (!existingPayment.user_id) {
        log.warn("Payment has no user_id — audit trail may be incomplete", {
          paymentId: mPaymentId,
        });
      }
      await logAuditEvent({
        actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
        actorRole: "member",
        action: "payment_completed",
        targetType: "payment",
        targetId: mPaymentId,
        metadata: { pfPaymentId, amountGross },
      });
    } else if (paymentStatus === "CANCELLED") {
      await supabase.from("payments").update({ status: "failed" }).eq("id", mPaymentId);
      log.info("Payment cancelled", { paymentId: mPaymentId, pfPaymentId });
    } else if (paymentStatus === "FAILED") {
      await supabase.from("payments").update({ status: "failed" }).eq("id", mPaymentId);
      log.warn("Payment failed", { paymentId: mPaymentId, pfPaymentId });
    } else if (paymentStatus === "PENDING") {
      // Payment is still pending (e.g. EFT/e-wallet) — no DB change needed,
      // the initial record was already created with status: 'pending'.
      log.info("Payment pending", { paymentId: mPaymentId, pfPaymentId });
    } else {
      log.warn("Unknown PayFast payment status", { paymentStatus, paymentId: mPaymentId });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Webhook processing failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
