import { PackageCheckout, type PackageCheckoutBlock } from "./package-checkout";
import { readPackagesOnSale } from "@/lib/foundation/slot-package-offer";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationMySlotPackage } from "@/lib/foundation/billing-runtime";
import { readOnlinePaymentMaxCents } from "@/lib/foundation/payment-limits";
import { readMyUnpaidIndividualInvoices } from "@/lib/foundation/customer-invoices";
import {
  isPackageTerm,
  PACKAGE_MAX_SLOTS,
  PACKAGE_MIN_SLOTS,
  PACKAGE_TERMS,
} from "@/lib/billing/slot-packages";
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

/** The member's unpaid Individual slot invoices (D6); none when they cannot
 * be read or nobody is signed in. */
async function unpaidIndividualInvoices(): Promise<string[]> {
  try {
    return await readMyUnpaidIndividualInvoices((await readFoundationServerSession()).api);
  } catch (error) {
    logDegradedRead(log, "Invoices unavailable", error);
    return [];
  }
}

/**
 * The Multi-listing checkout (roadmap P4a). Always shown (launch checklist
 * item 71: no visible link leads to a 404). While the owner's sales switch in
 * the database is off it shows the three fixed terms with no plan: "Pay" is
 * refused by the route ("Multi-listing packages are not on sale yet.") and
 * "Ask for an invoice" says the same on the page. No plan id is ever made up.
 */
export default async function PackageCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ slots?: string; days?: string }>;
}) {
  const offer = await readPackagesOnSale();
  const { slots, days } = await searchParams;
  const typed = Number(slots);
  const initialSlots =
    Number.isSafeInteger(typed) && typed >= PACKAGE_MIN_SLOTS && typed <= PACKAGE_MAX_SLOTS
      ? typed
      : 25;
  const term = Number(days);
  const [block, onlineMaxCents, unpaidInvoices] = await Promise.all([
    packageBlock(),
    readOnlinePaymentMaxCents(),
    unpaidIndividualInvoices(),
  ]);
  return (
    <PackageCheckout
      terms={
        offer
          ? offer.plans.map((plan) => ({ planId: plan.id, days: plan.term_days }))
          : PACKAGE_TERMS.map((days) => ({ planId: null, days }))
      }
      initialSlots={initialSlots}
      initialDays={isPackageTerm(term) ? term : 30}
      block={block}
      onlineMaxCents={onlineMaxCents}
      unpaidInvoices={unpaidInvoices}
    />
  );
}
