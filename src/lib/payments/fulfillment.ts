import { logAuditEvent } from "@/lib/services/audit";
import {
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
} from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import { getPaymentMetadata, type PaymentRecordShape } from "./types";
import { getOwnerColumn, type OwnerColumn } from "@/lib/account/compat";
import { resolveBillingPlanSelection } from "@/lib/billing/plan-resolver";

const log = createLogger("PaymentFulfillment");
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const VAT_RATE_BPS = 1500;

function computeVatInclusiveBreakdown(totalCents: number): {
  amountCents: number;
  vatCents: number;
} {
  const vatCents = Math.round((totalCents * VAT_RATE_BPS) / (10000 + VAT_RATE_BPS));
  return {
    amountCents: totalCents - vatCents,
    vatCents,
  };
}

function buildInvoiceNumber(payment: PaymentRecordShape): string {
  // Use SAST (UTC+2) for invoice dates — South African business requirement
  const utcMs = payment.created_at ? new Date(payment.created_at).getTime() : Date.now();
  const sastMs = utcMs + 2 * 60 * 60 * 1000;
  const date = new Date(sastMs).toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${date}-${payment.id.slice(0, 8).toUpperCase()}`;
}

type AdminClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => {
          maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        };
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
    upsert: (
      value: Record<string, unknown>,
      options: { onConflict: string }
    ) => Promise<{ error?: { message?: string } | null }>;
    insert: (value: Record<string, unknown>) => Promise<{ error?: { message?: string } | null }>;
    update: (value: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (column: string, value: string) => Promise<{ error?: { message?: string } | null }>;
      };
    };
  };
};

export async function rollbackPaymentProcessing(
  supabase: AdminClient,
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

export async function fulfillPayment(
  supabase: AdminClient,
  payment: PaymentRecordShape
): Promise<void> {
  const meta = getPaymentMetadata(payment);
  if (!meta) {
    throw new Error(`Payment ${payment.id} has no parseable metadata — cannot fulfil`);
  }
  if (!payment.user_id) {
    throw new Error(`Payment ${payment.id} has no user_id — cannot fulfil`);
  }

  // Resolve owner columns dynamically via compat layer instead of hardcoding "owner_id"
  const client = supabase as unknown as { from: (table: string) => unknown };
  let listingsOwnerCol: OwnerColumn = "owner_id";
  let businessesOwnerCol: OwnerColumn = "owner_id";
  let promotionsOwnerCol: OwnerColumn = "owner_id";
  try {
    [listingsOwnerCol, businessesOwnerCol, promotionsOwnerCol] = await Promise.all([
      getOwnerColumn(client as never, "listings"),
      getOwnerColumn(client as never, "businesses"),
      getOwnerColumn(client as never, "promotions"),
    ]);
  } catch {
    log.warn("Owner column detection failed, falling back to owner_id");
  }

  // Storefronts are not in OWNER_COMPAT_TABLES — probe separately
  let storefrontsOwnerCol: OwnerColumn = "owner_id";
  try {
    const probe = await (
      supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            limit: (n: number) => Promise<{ error?: { code?: string } | null }>;
          };
        };
      }
    )
      .from("storefronts")
      .select("id, owner_id")
      .limit(1);
    if (probe.error?.code === "42703") {
      storefrontsOwnerCol = "seller_id";
    }
  } catch {
    log.warn("Storefront owner column detection failed, falling back to owner_id");
  }

  // Anchor all duration calculations to payment creation time for idempotent re-runs
  const baseTime = payment.created_at ? new Date(payment.created_at).getTime() : Date.now();

  const planId = typeof meta.plan_id === "string" ? meta.plan_id : null;
  if (planId) {
    const { plan, error: planError } = await resolveBillingPlanSelection(supabase as never, planId);

    if (planError) {
      throw new Error(`Plan lookup failed: ${planError.message}`);
    }

    if (plan?.tier && plan?.area) {
      // Check account status before creating active entitlements
      const { data: accountProfile } = await supabase
        .from("account_profiles")
        .select("account_status")
        .eq("user_id", payment.user_id)
        .maybeSingle();

      const entitlementStatus =
        accountProfile?.account_status === "restricted" ? "pending_verification" : "active";

      const { error } = await supabase.from("entitlements").upsert(
        {
          user_id: payment.user_id,
          area: plan.area,
          tier: plan.tier,
          type: "subscription",
          status: entitlementStatus,
          started_at: new Date(baseTime).toISOString(),
          expires_at: new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "user_id,area,type" }
      );

      if (error) {
        throw new Error(`Entitlement creation failed: ${error.message}`);
      }

      // Idempotent invoice creation for successful subscription activations.
      const { data: existingInvoice } = await supabase
        .from("invoices")
        .select("id")
        .eq("payment_id", payment.id)
        .maybeSingle();

      if (!existingInvoice) {
        const breakdown = computeVatInclusiveBreakdown(payment.amount_cents);
        const { error: invoiceError } = await supabase.from("invoices").insert({
          invoice_number: buildInvoiceNumber(payment),
          user_id: payment.user_id,
          payment_id: payment.id,
          amount_cents: breakdown.amountCents,
          vat_cents: breakdown.vatCents,
          total_cents: payment.amount_cents,
          description: `${plan.tier} subscription (${plan.area})`,
        });

        if (invoiceError) {
          throw new Error(`Invoice creation failed: ${invoiceError.message}`);
        }
      }

      const isPlanChange = meta.is_plan_change === true;
      const previousEntitlementId =
        typeof meta.previous_entitlement_id === "string" ? meta.previous_entitlement_id : null;

      if (isPlanChange && previousEntitlementId) {
        const { data: previousEntitlement } = await supabase
          .from("entitlements")
          .select("id, status")
          .eq("id", previousEntitlementId)
          .eq("user_id", payment.user_id)
          .maybeSingle();

        if (previousEntitlement?.status === "active") {
          const { error: previousUpdateError } = await supabase
            .from("entitlements")
            .update({
              status: "cancelled",
              cancelled_at: new Date(baseTime).toISOString(),
            })
            .eq("id", previousEntitlementId)
            .eq("user_id", payment.user_id);

          if (previousUpdateError) {
            throw new Error(
              `Previous entitlement cancellation failed: ${previousUpdateError.message}`
            );
          }

          await logAuditEvent({
            actorId: payment.user_id || SYSTEM_ACTOR_ID,
            actorRole: "member",
            action: "subscription_cancelled",
            targetType: "entitlement",
            targetId: previousEntitlementId,
            metadata: {
              reason: "plan_change",
              paymentId: payment.id,
              replaced_by_plan_id: plan.id,
            },
          });
        }
      }
    }
  }

  if (meta.type === "boost" && typeof meta.listing_id === "string") {
    const boostDays =
      typeof meta.boost_days === "number" && meta.boost_days > 0
        ? meta.boost_days
        : BOOST_DURATION_DAYS;
    const boostUntil = new Date(baseTime + boostDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("listings")
      .update({ boost_until: boostUntil })
      .eq("id", meta.listing_id)
      .eq(listingsOwnerCol, payment.user_id);
    if (error) {
      throw new Error(`Boost update failed: ${error.message}`);
    }
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "listing_boosted",
      targetType: "listing",
      targetId: meta.listing_id,
      metadata: { paymentId: payment.id, boostDays, boostUntil },
    });
  }

  if (
    meta.type === "boost_business" &&
    (typeof meta.business_id === "string" || typeof meta.business_profile_id === "string")
  ) {
    const targetId =
      typeof meta.business_id === "string"
        ? meta.business_id
        : (meta.business_profile_id as string);
    const boostDays =
      typeof meta.boost_days === "number" && meta.boost_days > 0
        ? meta.boost_days
        : BOOST_DURATION_DAYS;
    const boostUntil = new Date(baseTime + boostDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("businesses")
      .update({ boost_until: boostUntil })
      .eq("id", targetId)
      .eq(businessesOwnerCol, payment.user_id);
    if (error) {
      throw new Error(`Business boost update failed: ${error.message}`);
    }
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "business_boosted",
      targetType: "business",
      targetId,
      metadata: { paymentId: payment.id, boostDays, boostUntil },
    });
  }

  if (meta.type === "boost_storefront" && typeof meta.storefront_id === "string") {
    const boostDays =
      typeof meta.boost_days === "number" && meta.boost_days > 0
        ? meta.boost_days
        : BOOST_DURATION_DAYS;
    const boostUntil = new Date(baseTime + boostDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("storefronts")
      .update({ boost_until: boostUntil })
      .eq("id", meta.storefront_id)
      .eq(storefrontsOwnerCol, payment.user_id);
    if (error) {
      throw new Error(`Storefront boost update failed: ${error.message}`);
    }
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "storefront_boosted",
      targetType: "storefront",
      targetId: meta.storefront_id,
      metadata: { paymentId: payment.id, boostDays, boostUntil },
    });
  }

  if (meta.type === "featured" && typeof meta.listing_id === "string") {
    const featureDays =
      typeof meta.feature_days === "number" && meta.feature_days > 0
        ? meta.feature_days
        : FEATURED_DURATION_DAYS;
    const featuredUntil = new Date(baseTime + featureDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("listings")
      .update({ featured_until: featuredUntil })
      .eq("id", meta.listing_id)
      .eq(listingsOwnerCol, payment.user_id);
    if (error) {
      throw new Error(`Featured update failed: ${error.message}`);
    }
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "listing_featured",
      targetType: "listing",
      targetId: meta.listing_id,
      metadata: { paymentId: payment.id, featureDays, featuredUntil },
    });
  }

  if (meta.type === "urgent" && typeof meta.listing_id === "string") {
    const urgentDays =
      typeof meta.urgent_days === "number" && meta.urgent_days > 0
        ? meta.urgent_days
        : URGENT_DURATION_DAYS;
    const urgentUntil = new Date(baseTime + urgentDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("listings")
      .update({ urgent_until: urgentUntil })
      .eq("id", meta.listing_id)
      .eq(listingsOwnerCol, payment.user_id);
    if (error) {
      throw new Error(`Urgent update failed: ${error.message}`);
    }
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "listing_urgent",
      targetType: "listing",
      targetId: meta.listing_id,
      metadata: { paymentId: payment.id, urgentDays, urgentUntil },
    });
  }

  if (meta.type === "boost_promotion" && typeof meta.promotion_id === "string") {
    const boostDays =
      typeof meta.boost_days === "number" && meta.boost_days > 0
        ? meta.boost_days
        : BOOST_DURATION_DAYS;
    const boostUntil = new Date(baseTime + boostDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("promotions")
      .update({ boost_until: boostUntil })
      .eq("id", meta.promotion_id)
      .eq(promotionsOwnerCol, payment.user_id);
    if (error) {
      throw new Error(`Promotion boost update failed: ${error.message}`);
    }
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "promotion_boosted",
      targetType: "promotion",
      targetId: meta.promotion_id,
      metadata: { paymentId: payment.id, boostDays, boostUntil },
    });
  }

  if (meta.type === "featured_promotion" && typeof meta.promotion_id === "string") {
    const featureDays =
      typeof meta.feature_days === "number" && meta.feature_days > 0
        ? meta.feature_days
        : FEATURED_DURATION_DAYS;
    const featuredUntil = new Date(baseTime + featureDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("promotions")
      .update({ featured_until: featuredUntil })
      .eq("id", meta.promotion_id)
      .eq(promotionsOwnerCol, payment.user_id);
    if (error) {
      throw new Error(`Promotion featured update failed: ${error.message}`);
    }
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "promotion_featured",
      targetType: "promotion",
      targetId: meta.promotion_id,
      metadata: { paymentId: payment.id, featureDays, featuredUntil },
    });
  }
}
