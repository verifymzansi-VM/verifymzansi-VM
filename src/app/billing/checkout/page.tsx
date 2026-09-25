import { redirect } from "next/navigation";
import { CheckoutConfirm, type CheckoutSummary } from "./checkout-confirm";
import { resolveBillingPlanSelection } from "@/lib/billing/plan-resolver";
import { formatDurationDays, isLegacyPlanTier } from "@/lib/constants/pricing";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREA_LABELS: Record<string, string> = {
  MZANSI_MARKET: "Mzansi Market",
  MZANSI_BUSINESS: "Mzansi Business",
  PROMOTIONS_EVENTS: "Tourism",
};

async function loadSummary(planId: string): Promise<CheckoutSummary | null> {
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
  };
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan: planId } = await searchParams;
  if (!planId) redirect("/pricing");
  const summary = UUID.test(planId) ? await loadSummary(planId).catch(() => null) : null;
  return <CheckoutConfirm summary={summary} />;
}
