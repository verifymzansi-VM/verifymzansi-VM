import { redirect } from "next/navigation";
import { CheckoutConfirm } from "./checkout-confirm";
import { readFoundationCheckoutSummary } from "@/lib/foundation/checkout-summary";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationMySlots } from "@/lib/foundation/billing-runtime";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

export const metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

async function loadSummary(planId: string) {
  const summary = await readFoundationCheckoutSummary(planId);
  if (!summary?.slotTerms) return summary;
  return { ...summary, slotStatus: await loadSlotStatus() };
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
  // Without a summary, say whether paid slots are paused rather than "not available".
  const paused = summary ? false : !(await getCommercialCatalog()).onSale;
  return <CheckoutConfirm summary={summary} paused={paused} />;
}
