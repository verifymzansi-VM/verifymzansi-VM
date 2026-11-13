import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { MySlots } from "@/components/billing/my-slots";
import {
  FoundationServerSessionError,
  readFoundationServerSession,
} from "@/lib/foundation/server-session";
import { FoundationBillingError, readFoundationMySlots } from "@/lib/foundation/billing-runtime";
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

/** The member's slots; null when they cannot be read right now. A signed-out
 * visitor goes to sign in; a refused account is an error, not an outage. */
async function mySlots() {
  try {
    return await readFoundationMySlots((await readFoundationServerSession()).api);
  } catch (error) {
    if (error instanceof FoundationServerSessionError && error.status === 401) redirect("/login");
    if (
      (error instanceof FoundationServerSessionError || error instanceof FoundationBillingError) &&
      error.status !== 503
    )
      throw error;
    logDegradedRead(log, "My slots unavailable", error);
    return null;
  }
}

export default async function MySlotsPage() {
  const [mine, buyHref] = await Promise.all([mySlots(), buySlotHref()]);
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="My slots"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "My slots" }]}
      />
      {mine ? (
        <MySlots slots={mine.slots} individual={mine.individual} buyHref={buyHref} />
      ) : (
        <p
          role="status"
          className="rounded-2xl border border-border p-5 text-sm text-muted-foreground"
        >
          Your slots cannot be shown right now. Please try again in a few minutes.
        </p>
      )}
    </div>
  );
}
