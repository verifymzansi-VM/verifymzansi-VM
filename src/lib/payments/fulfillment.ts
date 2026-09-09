import {
  BOOST_DURATION_DAYS,
  FEATURED_DURATION_DAYS,
  URGENT_DURATION_DAYS,
} from "@/lib/constants/pricing";
import { getPaymentMetadata, type PaymentRecordShape } from "./types";
import { resolveBillingPlanSelection } from "@/lib/billing/plan-resolver";
import { validateCanonicalPaidPlan } from "@/lib/billing/plan-catalog";

type AdminClient = Parameters<typeof resolveBillingPlanSelection>[0] & {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export type FulfillmentResult = {
  outcome: "completed" | "duplicate" | "recovered" | "ignored";
  expires_at?: string | null;
};

const ADDON_DURATIONS: Record<string, { key: string; days: number }> = {
  boost: { key: "boost_days", days: BOOST_DURATION_DAYS },
  boost_business: { key: "boost_days", days: BOOST_DURATION_DAYS },
  boost_storefront: { key: "boost_days", days: BOOST_DURATION_DAYS },
  boost_promotion: { key: "boost_days", days: BOOST_DURATION_DAYS },
  featured: { key: "feature_days", days: FEATURED_DURATION_DAYS },
  featured_business: { key: "feature_days", days: FEATURED_DURATION_DAYS },
  featured_promotion: { key: "feature_days", days: FEATURED_DURATION_DAYS },
  urgent: { key: "urgent_days", days: URGENT_DURATION_DAYS },
  urgent_business: { key: "urgent_days", days: URGENT_DURATION_DAYS },
  urgent_promotion: { key: "urgent_days", days: URGENT_DURATION_DAYS },
};

/** Validate the catalog in application code, then commit all effects under the
 * database payment lock. Never fall back to separate writes if the RPC is absent.
 * The database rechecks stored metadata, amount, plan and ownership under lock. */
export async function fulfillPayment(
  supabase: AdminClient,
  payment: PaymentRecordShape,
  webhookPayload: Record<string, unknown> = {}
): Promise<FulfillmentResult> {
  if (!payment.user_id) throw new Error(`Payment ${payment.id} has no user_id — cannot fulfil`);
  const meta = getPaymentMetadata(payment);
  let planId: string | null = null;
  let addonDays: number | null = null;
  // Terminal/legacy records are reconciled under the DB lock without replaying
  // effects or requiring a plan that may since have been retired.
  if (["pending", "failed", "expired"].includes(payment.status)) {
    if (!meta) throw new Error(`Payment ${payment.id} has no parseable metadata — cannot fulfil`);
    if (meta.type === "subscription") {
      if (typeof meta.plan_id !== "string") throw new Error("Subscription has no plan ID");
      const { plan, error } = await resolveBillingPlanSelection(supabase, meta.plan_id, {
        requireActive: true,
      });
      if (error) throw new Error(`Plan lookup failed: ${error.message}`);
      if (!plan) throw new Error(`Plan ${meta.plan_id} not found or inactive`);
      const catalogError = validateCanonicalPaidPlan(plan);
      if (catalogError) throw new Error(`Paid plan validation failed: ${catalogError}`);
      if (payment.area !== plan.area || meta.area !== plan.area)
        throw new Error("Payment area does not match canonical plan");
      if (payment.amount_cents !== plan.price_cents)
        throw new Error("Payment amount does not match canonical plan");
      if (meta.plan_tier !== plan.tier)
        throw new Error("Payment metadata tier does not match canonical plan");
      planId = plan.id;
    } else {
      const duration = meta.type ? ADDON_DURATIONS[meta.type] : undefined;
      if (!duration) throw new Error("Unsupported payment type");
      const specific = meta[duration.key];
      addonDays = typeof specific === "number" && specific > 0 ? specific : duration.days;
      if (!Number.isFinite(addonDays)) throw new Error("Invalid addon duration");
    }
  }

  const { data, error } = await supabase.rpc("fulfill_ozow_payment", {
    p_payment_id: payment.id,
    p_provider_payment_id: payment.provider_payment_id,
    p_expected_amount: payment.amount_cents,
    p_expected_metadata: meta,
    p_plan_id: planId,
    p_addon_days: addonDays,
    p_webhook: webhookPayload,
  });
  if (error) throw new Error(`Payment fulfillment failed: ${error.message}`);
  const result = data as FulfillmentResult | null;
  if (!result || !["completed", "duplicate", "recovered", "ignored"].includes(result.outcome)) {
    throw new Error("Payment fulfillment returned an invalid result");
  }
  return result;
}
