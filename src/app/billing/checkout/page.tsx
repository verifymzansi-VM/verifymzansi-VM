import { redirect } from "next/navigation";
import { CheckoutConfirm, type CheckoutSummary } from "./checkout-confirm";
import { resolveBillingPlanSelection } from "@/lib/billing/plan-resolver";
import {
  ENTERPRISE_ADMINS_INCLUDED,
  formatDurationDays,
  isLegacyPlanTier,
} from "@/lib/constants/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDataBackend } from "@/lib/data-backend";
import { readFoundationCheckoutSummary } from "@/lib/foundation/checkout-summary";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationMySlots } from "@/lib/foundation/billing-runtime";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

export const metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREA_LABELS: Record<string, string> = {
  MZANSI_MARKET: "Mzansi Market",
  MZANSI_BUSINESS: "Mzansi Business",
  PROMOTIONS_EVENTS: "Tourism & Events",
};

const log = createLogger("CheckoutPage");

/** The member's Individual slots, so the checkout offers only what the
 * database would accept (ID review, limit). Without it the database still
 * refuses, and the page shows its answer. */
async function loadSlotStatus() {
  try {
    const { individual } = await readFoundationMySlots((await readFoundationServerSession()).api);
    return {
      verified: individual.verified,
      held: individual.held,
      pending: individual.pending,
      limit: individual.limit,
    };
  } catch (error) {
    logDegradedRead(log, "Checkout slot status unavailable", error);
    return null;
  }
}

async function loadSummary(planId: string): Promise<CheckoutSummary | null> {
  if (getDataBackend() === "foundation") {
    const summary = await readFoundationCheckoutSummary(planId);
    if (!summary?.slotTerms) return summary;
    return { ...summary, slotStatus: await loadSlotStatus() };
  }
  const { plan } = await resolveBillingPlanSelection(createAdminClient() as never, planId, {
    requireActive: true,
  });
  if (!plan || isLegacyPlanTier(plan.tier)) return null;
  const row = plan as typeof plan & {
    duration_days?: number | null;
    slot_capacity?: number | null;
    monthly_activation_limit?: number | null;
  };
  const durationDays = row.duration_days ?? 30;
  return {
    planId: plan.id,
    name: plan.name,
    areaLabel: plan.area ? (AREA_LABELS[plan.area] ?? plan.area) : "All sections",
    priceCents: plan.price_cents,
    durationDays,
    durationLabel: formatDurationDays(durationDays),
    slotCapacity: row.slot_capacity ?? 1,
    monthlyActivationLimit: row.monthly_activation_limit ?? null,
    administrators: plan.tier === "enterprise" ? ENTERPRISE_ADMINS_INCLUDED : null,
  };
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: planId } = await searchParams;
  if (!planId) redirect("/pricing");
  const summary = UUID.test(planId)
    ? await loadSummary(planId).catch((error: unknown) => {
        logDegradedRead(log, "Checkout summary unavailable", error);
        return null;
      })
    : null;
  return <CheckoutConfirm summary={summary} />;
}
