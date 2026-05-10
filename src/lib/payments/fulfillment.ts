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
import { validateCanonicalPaidPlan, type CanonicalPlanRow } from "@/lib/billing/plan-catalog";

const log = createLogger("PaymentFulfillment");
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const VAT_RATE_BPS = 1500;

type UpdateResult = {
  data?: Array<Record<string, unknown>> | null;
  error?: { message?: string } | null;
};

type UpdateFilter = PromiseLike<{ error?: { message?: string } | null }> & {
  eq: (column: string, value: string) => UpdateFilter;
  select: (columns: string) => Promise<UpdateResult>;
};

function computeVatInclusiveBreakdown(totalCents: number): {
  amountCents: number;
  vatCents: number;
} {
  const vatCents = Math.round((totalCents * VAT_RATE_BPS) / (10000 + VAT_RATE_BPS));
  const amountCents = totalCents - vatCents;
  if (amountCents + vatCents !== totalCents) {
    throw new Error(`VAT breakdown mismatch: ${amountCents} + ${vatCents} !== ${totalCents}`);
  }
  return { amountCents, vatCents };
}

function buildInvoiceNumber(payment: PaymentRecordShape): string {
  // Use SAST (UTC+2) for invoice dates — South African business requirement
  const utcMs = payment.created_at ? new Date(payment.created_at).getTime() : Date.now();
  const sastMs = utcMs + 2 * 60 * 60 * 1000;
  const date = new Date(sastMs).toISOString().slice(0, 10).replace(/-/g, "");
  return `INV-${date}-${payment.id.slice(0, 8).toUpperCase()}`;
}

function assertPaidPlanMatchesPayment(
  payment: PaymentRecordShape,
  meta: Record<string, unknown>,
  plan: CanonicalPlanRow
): void {
  const catalogError = validateCanonicalPaidPlan(plan);
  if (catalogError) {
    throw new Error(`Paid plan validation failed: ${catalogError}`);
  }

  if (payment.area !== plan.area) {
    throw new Error(
      `Payment area mismatch: payment ${payment.area} does not match plan ${plan.area}`
    );
  }

  if (payment.amount_cents !== plan.price_cents) {
    throw new Error(
      `Payment amount mismatch: payment ${payment.amount_cents} does not match plan ${plan.price_cents}`
    );
  }

  if (meta.area !== plan.area) {
    throw new Error("Payment metadata area does not match canonical plan");
  }

  if (meta.plan_tier !== plan.tier) {
    throw new Error("Payment metadata tier does not match canonical plan");
  }
}

function assertAddonUpdated(
  data: Array<Record<string, unknown>> | null | undefined,
  message: string
) {
  if (!data || data.length === 0) {
    throw new Error(message);
  }
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
    update: (value: Record<string, unknown>) => UpdateFilter;
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
  } catch (ownerColErr) {
    log.error("Owner column detection failed — aborting fulfillment to prevent misattribution", {
      error: ownerColErr instanceof Error ? ownerColErr.message : "Unknown",
    });
    throw new Error("Owner column detection failed — cannot safely fulfil payment");
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
  } catch (sfOwnerErr) {
    log.error("Storefront owner column detection failed — aborting fulfillment", {
      error: sfOwnerErr instanceof Error ? sfOwnerErr.message : "Unknown",
    });
    throw new Error("Storefront owner column detection failed — cannot safely fulfil payment");
  }

  // Anchor all duration calculations to payment creation time for idempotent re-runs
  const baseTime = payment.created_at ? new Date(payment.created_at).getTime() : Date.now();

  const planId = typeof meta.plan_id === "string" ? meta.plan_id : null;
  if (planId) {
    const { plan, error: planError } = await resolveBillingPlanSelection(
      supabase as never,
      planId,
      { requireActive: true }
    );

    if (planError) {
      throw new Error(`Plan lookup failed: ${planError.message}`);
    }

    if (!plan?.tier || !plan?.area) {
      throw new Error(`Plan ${planId} not found or inactive — cannot fulfil subscription`);
    }

    if (plan.tier && plan.area) {
      assertPaidPlanMatchesPayment(payment, meta, plan as CanonicalPlanRow);

      // Check account status before creating active entitlements
      const { data: accountProfile } = await supabase
        .from("account_profiles")
        .select("account_status")
        .eq("user_id", payment.user_id)
        .maybeSingle();

      if (!accountProfile) {
        throw new Error(
          `Account profile not found for user ${payment.user_id} — cannot create entitlement`
        );
      }

      const entitlementStatus =
        accountProfile.account_status === "restricted" ? "pending_verification" : "active";

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
    const { data, error } = await supabase
      .from("listings")
      .update({ boost_until: boostUntil })
      .eq("id", meta.listing_id)
      .eq(listingsOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Boost update failed: ${error.message}`);
    }
    assertAddonUpdated(data, `Boost update matched no listing for ${meta.listing_id}`);
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
    const { data, error } = await supabase
      .from("businesses")
      .update({ boost_until: boostUntil })
      .eq("id", targetId)
      .eq(businessesOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Business boost update failed: ${error.message}`);
    }
    assertAddonUpdated(data, `Business boost update matched no business for ${targetId}`);
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
    const { data, error } = await supabase
      .from("storefronts")
      .update({ boost_until: boostUntil })
      .eq("id", meta.storefront_id)
      .eq(storefrontsOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Storefront boost update failed: ${error.message}`);
    }
    assertAddonUpdated(
      data,
      `Storefront boost update matched no storefront for ${meta.storefront_id}`
    );
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
    const { data, error } = await supabase
      .from("listings")
      .update({ featured_until: featuredUntil })
      .eq("id", meta.listing_id)
      .eq(listingsOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Featured update failed: ${error.message}`);
    }
    assertAddonUpdated(data, `Featured update matched no listing for ${meta.listing_id}`);
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
    const { data, error } = await supabase
      .from("listings")
      .update({ urgent_until: urgentUntil })
      .eq("id", meta.listing_id)
      .eq(listingsOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Urgent update failed: ${error.message}`);
    }
    assertAddonUpdated(data, `Urgent update matched no listing for ${meta.listing_id}`);
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
    const { data, error } = await supabase
      .from("promotions")
      .update({ boost_until: boostUntil })
      .eq("id", meta.promotion_id)
      .eq(promotionsOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Promotion boost update failed: ${error.message}`);
    }
    assertAddonUpdated(
      data,
      `Promotion boost update matched no promotion for ${meta.promotion_id}`
    );
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
    const { data, error } = await supabase
      .from("promotions")
      .update({ featured_until: featuredUntil })
      .eq("id", meta.promotion_id)
      .eq(promotionsOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Promotion featured update failed: ${error.message}`);
    }
    assertAddonUpdated(
      data,
      `Promotion featured update matched no promotion for ${meta.promotion_id}`
    );
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "promotion_featured",
      targetType: "promotion",
      targetId: meta.promotion_id,
      metadata: { paymentId: payment.id, featureDays, featuredUntil },
    });
  }

  if (meta.type === "featured_business" && typeof meta.business_id === "string") {
    const featureDays =
      typeof meta.feature_days === "number" && meta.feature_days > 0
        ? meta.feature_days
        : FEATURED_DURATION_DAYS;
    const featuredUntil = new Date(baseTime + featureDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("businesses")
      .update({ featured_until: featuredUntil })
      .eq("id", meta.business_id)
      .eq(businessesOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Business featured update failed: ${error.message}`);
    }
    assertAddonUpdated(
      data,
      `Business featured update matched no business for ${meta.business_id}`
    );
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "business_featured",
      targetType: "business",
      targetId: meta.business_id,
      metadata: { paymentId: payment.id, featureDays, featuredUntil },
    });
  }

  if (meta.type === "urgent_business" && typeof meta.business_id === "string") {
    const urgentDays =
      typeof meta.urgent_days === "number" && meta.urgent_days > 0
        ? meta.urgent_days
        : URGENT_DURATION_DAYS;
    const urgentUntil = new Date(baseTime + urgentDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("businesses")
      .update({ urgent_until: urgentUntil })
      .eq("id", meta.business_id)
      .eq(businessesOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Business urgent update failed: ${error.message}`);
    }
    assertAddonUpdated(data, `Business urgent update matched no business for ${meta.business_id}`);
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "business_urgent",
      targetType: "business",
      targetId: meta.business_id,
      metadata: { paymentId: payment.id, urgentDays, urgentUntil },
    });
  }

  if (meta.type === "urgent_promotion" && typeof meta.promotion_id === "string") {
    const urgentDays =
      typeof meta.urgent_days === "number" && meta.urgent_days > 0
        ? meta.urgent_days
        : URGENT_DURATION_DAYS;
    const urgentUntil = new Date(baseTime + urgentDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from("promotions")
      .update({ urgent_until: urgentUntil })
      .eq("id", meta.promotion_id)
      .eq(promotionsOwnerCol, payment.user_id)
      .select("id");
    if (error) {
      throw new Error(`Promotion urgent update failed: ${error.message}`);
    }
    assertAddonUpdated(
      data,
      `Promotion urgent update matched no promotion for ${meta.promotion_id}`
    );
    await logAuditEvent({
      actorId: payment.user_id || SYSTEM_ACTOR_ID,
      actorRole: "member",
      action: "promotion_urgent",
      targetType: "promotion",
      targetId: meta.promotion_id,
      metadata: { paymentId: payment.id, urgentDays, urgentUntil },
    });
  }
}
