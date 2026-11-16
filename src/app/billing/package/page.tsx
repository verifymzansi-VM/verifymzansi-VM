import { notFound } from "next/navigation";
import { PackageCheckout, type PackageCheckoutBlock } from "./package-checkout";
import { readPackagesOnSale } from "@/lib/foundation/slot-package-offer";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  readFoundationMySlotPackage,
  readFoundationPaymentLimits,
} from "@/lib/foundation/billing-runtime";
import { isPackageTerm, PACKAGE_MAX_SLOTS, PACKAGE_MIN_SLOTS } from "@/lib/billing/slot-packages";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

export const metadata = { title: "Choose your package", robots: { index: false } };
export const dynamic = "force-dynamic";

const log = createLogger("PackageCheckoutPage");

/** What stops this member buying (an ID review not accepted, a package
 * already held); null when it cannot be read or nothing does (a signed-out
 * visitor is asked to sign in when they pay). The database decides again. */
async function packageBlock(): Promise<PackageCheckoutBlock | null> {
  try {
    const mine = await readFoundationMySlotPackage((await readFoundationServerSession()).api);
    if (!mine.verified) return "id_review";
    if (!mine.can_buy) return "has_package";
    return null;
  } catch (error) {
    logDegradedRead(log, "Package status unavailable", error);
    return null;
  }
}

/** The most one online (Ozow) payment may be; null when it cannot be read
 * (signed out included): the database still refuses above it. */
async function onlineMax(): Promise<number | null> {
  try {
    return (await readFoundationPaymentLimits((await readFoundationServerSession()).api))
      .onlineMaxCents;
  } catch (error) {
    logDegradedRead(log, "Package payment limit unavailable", error);
    return null;
  }
}

/**
 * The Multi-listing checkout (roadmap P4a). Hidden (not found) while packages
 * are not on sale: the owner's switch in the database, off until business
 * tools P5-P7 pass.
 */
export default async function PackageCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ slots?: string; days?: string }>;
}) {
  const offer = await readPackagesOnSale();
  if (!offer) notFound();
  const { slots, days } = await searchParams;
  const typed = Number(slots);
  const initialSlots =
    Number.isSafeInteger(typed) && typed >= PACKAGE_MIN_SLOTS && typed <= PACKAGE_MAX_SLOTS
      ? typed
      : 25;
  const term = Number(days);
  const [block, onlineMaxCents] = await Promise.all([packageBlock(), onlineMax()]);
  return (
    <PackageCheckout
      terms={offer.plans.map((plan) => ({ planId: plan.id, days: plan.term_days }))}
      initialSlots={initialSlots}
      initialDays={isPackageTerm(term) ? term : 30}
      block={block}
      onlineMaxCents={onlineMaxCents}
    />
  );
}
