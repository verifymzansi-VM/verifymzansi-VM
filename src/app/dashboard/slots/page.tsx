import { PageHeader } from "@/components/layout/page-header";
import { MySlots } from "@/components/billing/my-slots";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationMySlots } from "@/lib/foundation/billing-runtime";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import {
  individualSlotPlans,
  readFoundationBillingCatalogue,
} from "@/lib/foundation/billing-catalogue";
import { createLogger } from "@/lib/utils/logger";
import { logDegradedRead } from "@/lib/utils/request-failure";

export const metadata = { title: "My slots", robots: { index: false } };
export const dynamic = "force-dynamic";

const log = createLogger("MySlotsPage");

/** The 30-day Individual slot's checkout (30 days preselected), when on sale. */
async function buySlotHref() {
  try {
    const [shortest] = individualSlotPlans(
      await readFoundationBillingCatalogue(foundationServerPublicApi())
    );
    return shortest ? `/billing/checkout?plan=${shortest.id}` : null;
  } catch (error) {
    logDegradedRead(log, "Slot catalogue unavailable", error);
    return null;
  }
}

export default async function MySlotsPage() {
  const { api } = await readFoundationServerSession();
  const [mine, buyHref] = await Promise.all([readFoundationMySlots(api), buySlotHref()]);
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="My slots"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "My slots" }]}
      />
      <MySlots slots={mine.slots} individual={mine.individual} buyHref={buyHref} />
    </div>
  );
}
