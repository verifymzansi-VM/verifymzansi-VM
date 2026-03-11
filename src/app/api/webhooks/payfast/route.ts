import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPayFastSignature, isPayFastIp } from "@/lib/services/payfast";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { env } from "@/lib/config/env";
import {
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
} from "@/lib/constants/pricing";

const log = createLogger("PayFastWebhook");
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** Roll back payment status to "pending" so PayFast retries can re-claim it. */
async function rollbackPayment(
  supabase: ReturnType<typeof createAdminClient>,
  paymentId: string
): Promise<void> {
  const { error } = await supabase
    .from("payments")
    .update({ status: "pending" })
    .eq("id", paymentId)
    .eq("status", "processing");
  if (error) {
    log.error("Failed to roll back payment status", { paymentId, error: error.message });
  }
}

/**
 * PayFast ITN (Instant Transaction Notification) webhook handler.
 * This endpoint is called by PayFast when a payment status changes.
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
      .select("id, status, payfast_payment_id, amount_cents, user_id, payfast_data")
      .eq("id", mPaymentId)
      .maybeSingle();

    if (!existingPayment) {
      log.error("Payment not found", { paymentId: mPaymentId });
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
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
          payfast_payment_id: pfPaymentId,
        })
        .eq("id", mPaymentId)
        .neq("status", "complete")
        .neq("status", "processing")
        .select("id");

      if (!claimedRows?.length) {
        log.info("Duplicate ITN ignored (payment already claimed/complete)", {
          paymentId: mPaymentId,
        });
        return NextResponse.json({ success: true, duplicate: true });
      }

      // ── CAS succeeded — this request owns the payment. Process entitlements. ──

      // Create/update entitlement for subscription payments
      const pfData = existingPayment.payfast_data as Record<string, unknown> | null;
      const planId = pfData?.plan_id as string | undefined;
      if (planId) {
        // Get plan details
        const { data: plan } = await supabase
          .from("plans")
          .select("tier, area")
          .eq("id", planId)
          .maybeSingle();

        if (plan) {
          const { error: entitlementError } = await supabase.from("entitlements").upsert(
            {
              user_id: existingPayment.user_id,
              area: plan.area,
              tier: plan.tier,
              type: "subscription",
              status: "active",
              started_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            },
            { onConflict: "user_id,area,type" }
          );

          if (entitlementError) {
            log.error("Failed to create entitlement", {
              error: entitlementError.message,
              paymentId: mPaymentId,
            });
            await rollbackPayment(supabase, mPaymentId);
            return NextResponse.json({ error: "Entitlement creation failed" }, { status: 500 });
          }
        }
      }

      // ── Handle boost payment ─────────────────────────────
      const meta = existingPayment.payfast_data as Record<string, unknown> | null;
      if (meta?.type === "boost" && meta?.listing_id) {
        const boostDays =
          typeof meta.boost_days === "number" && meta.boost_days > 0
            ? meta.boost_days
            : BOOST_DURATION_DAYS;
        const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();

        const { error: boostError } = await supabase
          .from("listings")
          .update({ boost_until: boostUntil })
          .eq("id", meta.listing_id as string)
          .eq("seller_id", existingPayment.user_id);

        if (boostError) {
          log.error("Failed to boost listing", {
            error: boostError.message,
            paymentId: mPaymentId,
          });
          await rollbackPayment(supabase, mPaymentId);
          return NextResponse.json({ error: "Boost update failed" }, { status: 500 });
        }

        await logAuditEvent({
          actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
          actorRole: "member",
          action: "listing_boosted",
          targetType: "listing",
          targetId: meta.listing_id as string,
          metadata: { paymentId: mPaymentId, boostDays, boostUntil },
        });

        log.info("Listing boosted", {
          listingId: meta.listing_id,
          boostUntil,
        });
      }

      // ── Handle business boost (unified businesses table) ──
      if (meta?.type === "boost_business" && (meta?.business_id || meta?.business_profile_id)) {
        const targetId = (meta.business_id || meta.business_profile_id) as string;
        const boostDays =
          typeof meta.boost_days === "number" && meta.boost_days > 0
            ? meta.boost_days
            : BOOST_DURATION_DAYS;
        const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();

        const { error: boostError } = await supabase
          .from("businesses")
          .update({ boost_until: boostUntil })
          .eq("id", targetId)
          .eq("seller_id", existingPayment.user_id);

        if (boostError) {
          log.error("Failed to boost business", {
            error: boostError.message,
            paymentId: mPaymentId,
          });
          await rollbackPayment(supabase, mPaymentId);
          return NextResponse.json({ error: "Boost update failed" }, { status: 500 });
        }

        await logAuditEvent({
          actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
          actorRole: "member",
          action: "business_boosted",
          targetType: "business",
          targetId,
          metadata: { paymentId: mPaymentId, boostDays, boostUntil },
        });

        log.info("Business boosted", {
          businessId: targetId,
          boostUntil,
        });
      }

      // ── Handle storefront boost (legacy — kept for in-flight payments) ──
      if (meta?.type === "boost_storefront" && meta?.storefront_id) {
        const boostDays =
          typeof meta.boost_days === "number" && meta.boost_days > 0
            ? meta.boost_days
            : BOOST_DURATION_DAYS;
        const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();

        const { error: boostError } = await supabase
          .from("storefronts")
          .update({ boost_until: boostUntil })
          .eq("id", meta.storefront_id as string)
          .eq("seller_id", existingPayment.user_id);

        if (boostError) {
          log.error("Failed to boost storefront", {
            error: boostError.message,
            paymentId: mPaymentId,
          });
          await rollbackPayment(supabase, mPaymentId);
          return NextResponse.json({ error: "Boost update failed" }, { status: 500 });
        }

        await logAuditEvent({
          actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
          actorRole: "member",
          action: "storefront_boosted",
          targetType: "storefront",
          targetId: meta.storefront_id as string,
          metadata: { paymentId: mPaymentId, boostDays, boostUntil },
        });

        log.info("Storefront boosted", {
          storefrontId: meta.storefront_id,
          boostUntil,
        });
      }

      // ── Handle listing featured add-on ──────────────────────
      if (meta?.type === "featured" && meta?.listing_id) {
        const featureDays =
          typeof meta.feature_days === "number" && meta.feature_days > 0
            ? meta.feature_days
            : FEATURED_DURATION_DAYS;
        const featuredUntil = new Date(
          Date.now() + featureDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const { error: featuredError } = await supabase
          .from("listings")
          .update({ featured_until: featuredUntil })
          .eq("id", meta.listing_id as string)
          .eq("seller_id", existingPayment.user_id);

        if (featuredError) {
          log.error("Failed to feature listing", {
            error: featuredError.message,
            paymentId: mPaymentId,
          });
          await rollbackPayment(supabase, mPaymentId);
          return NextResponse.json({ error: "Featured update failed" }, { status: 500 });
        }

        await logAuditEvent({
          actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
          actorRole: "member",
          action: "listing_featured",
          targetType: "listing",
          targetId: meta.listing_id as string,
          metadata: { paymentId: mPaymentId, featureDays, featuredUntil },
        });

        log.info("Listing featured", {
          listingId: meta.listing_id,
          featuredUntil,
        });
      }

      // ── Handle listing urgent add-on ───────────────────────
      if (meta?.type === "urgent" && meta?.listing_id) {
        const urgentDays =
          typeof meta.urgent_days === "number" && meta.urgent_days > 0
            ? meta.urgent_days
            : URGENT_DURATION_DAYS;
        const urgentUntil = new Date(Date.now() + urgentDays * 24 * 60 * 60 * 1000).toISOString();

        const { error: urgentError } = await supabase
          .from("listings")
          .update({ urgent_until: urgentUntil })
          .eq("id", meta.listing_id as string)
          .eq("seller_id", existingPayment.user_id);

        if (urgentError) {
          log.error("Failed to mark listing urgent", {
            error: urgentError.message,
            paymentId: mPaymentId,
          });
          await rollbackPayment(supabase, mPaymentId);
          return NextResponse.json({ error: "Urgent update failed" }, { status: 500 });
        }

        await logAuditEvent({
          actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
          actorRole: "member",
          action: "listing_urgent",
          targetType: "listing",
          targetId: meta.listing_id as string,
          metadata: { paymentId: mPaymentId, urgentDays, urgentUntil },
        });

        log.info("Listing marked urgent", {
          listingId: meta.listing_id,
          urgentUntil,
        });
      }

      // ── Handle promotion boost add-on ─────────────────────
      if (meta?.type === "boost_promotion" && meta?.promotion_id) {
        const boostDays =
          typeof meta.boost_days === "number" && meta.boost_days > 0
            ? meta.boost_days
            : BOOST_DURATION_DAYS;
        const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();

        const { error: boostError } = await supabase
          .from("promotions")
          .update({ boost_until: boostUntil })
          .eq("id", meta.promotion_id as string)
          .eq("seller_id", existingPayment.user_id);

        if (boostError) {
          log.error("Failed to boost promotion", {
            error: boostError.message,
            paymentId: mPaymentId,
          });
          await rollbackPayment(supabase, mPaymentId);
          return NextResponse.json({ error: "Boost update failed" }, { status: 500 });
        }

        await logAuditEvent({
          actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
          actorRole: "member",
          action: "listing_boosted",
          targetType: "promotion",
          targetId: meta.promotion_id as string,
          metadata: { paymentId: mPaymentId, boostDays, boostUntil },
        });

        log.info("Promotion boosted", {
          promotionId: meta.promotion_id,
          boostUntil,
        });
      }

      // ── Handle promotion featured add-on ──────────────────
      if (meta?.type === "featured_promotion" && meta?.promotion_id) {
        const featureDays =
          typeof meta.feature_days === "number" && meta.feature_days > 0
            ? meta.feature_days
            : FEATURED_DURATION_DAYS;
        const featuredUntil = new Date(
          Date.now() + featureDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const { error: featuredError } = await supabase
          .from("promotions")
          .update({ featured_until: featuredUntil })
          .eq("id", meta.promotion_id as string)
          .eq("seller_id", existingPayment.user_id);

        if (featuredError) {
          log.error("Failed to feature promotion", {
            error: featuredError.message,
            paymentId: mPaymentId,
          });
          await rollbackPayment(supabase, mPaymentId);
          return NextResponse.json({ error: "Featured update failed" }, { status: 500 });
        }

        await logAuditEvent({
          actorId: existingPayment.user_id || SYSTEM_ACTOR_ID,
          actorRole: "member",
          action: "listing_featured",
          targetType: "promotion",
          targetId: meta.promotion_id as string,
          metadata: { paymentId: mPaymentId, featureDays, featuredUntil },
        });

        log.info("Promotion featured", {
          promotionId: meta.promotion_id,
          featuredUntil,
        });
      }

      // ── All processing succeeded — finalize payment status ──
      const existingMeta = (existingPayment.payfast_data as Record<string, unknown> | null) || {};
      await supabase
        .from("payments")
        .update({
          status: "complete",
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
