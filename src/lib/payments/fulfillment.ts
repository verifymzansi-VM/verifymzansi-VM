import { logAuditEvent } from "@/lib/services/audit";
import {
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
} from "@/lib/constants/pricing";
import { createLogger } from "@/lib/utils/logger";
import { getPaymentMetadata, type PaymentRecordShape } from "./types";
import { getOwnerColumn, type OwnerColumn } from "@/lib/account/compat";

const log = createLogger("PaymentFulfillment");
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

type AdminClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
      };
    };
    upsert: (
      value: Record<string, unknown>,
      options: { onConflict: string }
    ) => Promise<{ error?: { message?: string } | null }>;
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
  if (!meta || !payment.user_id) {
    return;
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

  const planId = typeof meta.plan_id === "string" ? meta.plan_id : null;
  if (planId) {
    const { data: plan } = await supabase
      .from("plans")
      .select("tier, area")
      .eq("id", planId)
      .maybeSingle();

    if (plan?.tier && plan?.area) {
      const { error } = await supabase.from("entitlements").upsert(
        {
          user_id: payment.user_id,
          area: plan.area,
          tier: plan.tier,
          type: "subscription",
          status: "active",
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "user_id,area,type" }
      );

      if (error) {
        throw new Error(`Entitlement creation failed: ${error.message}`);
      }
    }
  }

  if (meta.type === "boost" && typeof meta.listing_id === "string") {
    const boostDays =
      typeof meta.boost_days === "number" && meta.boost_days > 0
        ? meta.boost_days
        : BOOST_DURATION_DAYS;
    const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();
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
    const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();
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
    const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("storefronts")
      .update({ boost_until: boostUntil })
      .eq("id", meta.storefront_id)
      .eq(listingsOwnerCol, payment.user_id);
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
    const featuredUntil = new Date(Date.now() + featureDays * 24 * 60 * 60 * 1000).toISOString();
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
    const urgentUntil = new Date(Date.now() + urgentDays * 24 * 60 * 60 * 1000).toISOString();
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
    const boostUntil = new Date(Date.now() + boostDays * 24 * 60 * 60 * 1000).toISOString();
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
      action: "listing_boosted",
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
    const featuredUntil = new Date(Date.now() + featureDays * 24 * 60 * 60 * 1000).toISOString();
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
      action: "listing_featured",
      targetType: "promotion",
      targetId: meta.promotion_id,
      metadata: { paymentId: payment.id, featureDays, featuredUntil },
    });
  }
}
