import { notFound } from "next/navigation";
import {
  PackageAddCheckout,
  type PackageAddBlock,
  type PackageAddOffer,
} from "./package-add-checkout";
import { readPackagesOnSale } from "@/lib/foundation/slot-package-offer";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  readFoundationPackageAddOffer,
  type FoundationPackageAddOffer,
} from "@/lib/foundation/billing-runtime";
import { readOnlinePaymentMaxCents } from "@/lib/foundation/payment-limits";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

export const metadata = { title: "Add slots", robots: { index: false } };
export const dynamic = "force-dynamic";

const log = createLogger("PackageAddPage");

/** The member's running package as the page offers it; null when it cannot be
 * read (the page then says there is none; the database decides again). */
async function readOffer(): Promise<FoundationPackageAddOffer | null> {
  try {
    return await readFoundationPackageAddOffer((await readFoundationServerSession()).api);
  } catch (error) {
    logDegradedRead(log, "Package add offer unavailable", error);
    return null;
  }
}

function toOffer(read: FoundationPackageAddOffer | null): PackageAddOffer | null {
  const held = read?.package;
  if (!held || held.unit_price_cents === null) return null;
  const request = held.request;
  return {
    packageId: held.id,
    places: held.places,
    endsAt: held.ends_at,
    daysLeft: held.days_left,
    unitPriceCents: Number(held.unit_price_cents),
    maxSlots: held.max_slots,
    onlineOpen: held.online_open,
    invoiceOpen: held.invoice_open,
    invoiceUnpaid: held.invoice_unpaid,
    requestOpen:
      request && (request.status === "requested" || request.status === "awaiting_approval")
        ? { slots: request.slots, totalCents: request.total_cents }
        : null,
  };
}

/**
 * "Add slots" to the member's running Multi-listing package (roadmap P4b).
 * Hidden (not found) while packages are not on sale: the owner's switch in the
 * database, off until the launch switch-on.
 */
export default async function PackageAddPage({
  searchParams,
}: {
  searchParams: Promise<{ slots?: string }>;
}) {
  if (!(await readPackagesOnSale())) notFound();
  const { slots } = await searchParams;
  const [read, onlineMaxCents] = await Promise.all([readOffer(), readOnlinePaymentMaxCents()]);
  const offer = toOffer(read);
  const block: PackageAddBlock | null =
    read && !read.verified
      ? "id_review"
      : !offer
        ? "no_package"
        : !offer.onlineOpen && !offer.invoiceOpen
          ? "too_late"
          : null;
  const typed = Number(slots);
  return (
    <PackageAddCheckout
      offer={offer}
      block={block}
      onlineMaxCents={onlineMaxCents}
      initialSlots={
        offer && Number.isSafeInteger(typed) && typed >= 1 && typed <= offer.maxSlots
          ? typed
          : Math.max(1, Math.min(5, offer?.maxSlots ?? 5))
      }
    />
  );
}
