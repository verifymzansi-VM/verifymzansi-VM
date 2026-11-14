import { redirect } from "next/navigation";
import { CheckoutConfirm, type RenewalSlot } from "./checkout-confirm";
import { readFoundationCheckoutSummary } from "@/lib/foundation/checkout-summary";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationMySlots, type FoundationMySlots } from "@/lib/foundation/billing-runtime";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import {
  individualSlotPlans,
  readFoundationBillingCatalogue,
} from "@/lib/foundation/billing-catalogue";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

export const metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const log = createLogger("CheckoutPage");
/** "Renew all" from a reminder email: the slots ending within this many days. */
const SOON_DAYS = 7;

/** The member's slots (api.get_my_slots_v2); null when they cannot be read. */
async function loadMySlots(): Promise<FoundationMySlots | null> {
  try {
    return await readFoundationMySlots((await readFoundationServerSession()).api);
  } catch (error) {
    logDegradedRead(log, "Checkout slot status unavailable", error);
    return null;
  }
}

/** The member's Individual slots, so the checkout offers only what the
 * database would accept (ID review, limit). Without it the database still
 * refuses, and the page shows its answer. */
function slotStatus(mine: FoundationMySlots | null) {
  if (!mine) return null;
  const { individual } = mine;
  return {
    verified: individual.verified,
    held: individual.held,
    pending: individual.pending,
    limit: individual.limit,
  };
}

/** The slots a renewal link names: "all" (every slot that can be renewed now),
 * "soon" (those ending within 7 days, from the reminder email) or slot ids.
 * Each renewal starts when its slot's current (or already renewed) days end. */
function renewalSlots(mine: FoundationMySlots, renew: string, now = Date.now()): RenewalSlot[] {
  const renewable = mine.slots.filter((slot) => slot.individual && slot.renewable);
  const ids = new Set(renew.split(",").filter((id) => UUID.test(id)));
  const chosen =
    renew === "all"
      ? renewable
      : renew === "soon"
        ? renewable.filter(
            (slot) => Date.parse(slot.renewed_until ?? slot.ends_at) <= now + SOON_DAYS * 86_400_000
          )
        : renewable.filter((slot) => ids.has(slot.id));
  return chosen.map((slot) => ({
    id: slot.id,
    startsAt: slot.renewed_until ?? slot.ends_at,
    postTitle: slot.posts[0]?.title ?? null,
  }));
}

async function loadSummary(planId: string, renew: string | undefined) {
  const summary = await readFoundationCheckoutSummary(planId);
  if (!summary?.slotTerms) return summary;
  const mine = await loadMySlots();
  return {
    ...summary,
    slotStatus: slotStatus(mine),
    ...(renew !== undefined && { renewal: mine ? renewalSlots(mine, renew) : null }),
  };
}

/** A renewal link may come without a term (the reminder email): 30 days. */
async function shortestSlotPlan() {
  try {
    const [shortest] = individualSlotPlans(
      await readFoundationBillingCatalogue(foundationServerPublicApi())
    );
    return shortest?.id;
  } catch (error) {
    logDegradedRead(log, "Slot catalogue unavailable", error);
    return undefined;
  }
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; renew?: string }>;
}) {
  const { plan, renew } = await searchParams;
  const planId = plan ?? (renew ? await shortestSlotPlan() : undefined);
  if (!planId) redirect(renew ? "/dashboard/slots" : "/pricing");
  const summary = UUID.test(planId)
    ? await loadSummary(planId, renew).catch((error: unknown) => {
        logDegradedRead(log, "Checkout summary unavailable", error);
        return null;
      })
    : null;
  // Without a summary, say whether paid slots are paused rather than "not available".
  const paused = summary ? false : !(await getCommercialCatalog()).onSale;
  return <CheckoutConfirm summary={summary} paused={paused} />;
}
