import { requireStaff } from "@/lib/auth/require-staff";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readStaffModerationQueue } from "@/lib/foundation/staff-moderation-queue";
import { FoundationStaffReadError } from "@/lib/foundation/staff-read";
import { redirect } from "next/navigation";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { QueueClaimBar, QueueClaimsProvider } from "@/components/admin/queue-claims";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { ModerationQueueClient } from "@/components/admin/moderation/moderation-queue-client";

export const metadata = {
  title: "Content moderation — Admin",
  description: "Review and moderate flagged content, listings, and user reports.",
};

const SHOWN_PER_TYPE = 50;

export default async function AdminModerationPage() {
  const { user, role } = await requireStaff("queue:view");
  const result = await (async () => {
    const current = await readFoundationServerSession();
    if (current.user.id !== user.id) throw new FoundationStaffReadError(503);
    try {
      return await readStaffModerationQueue(current.api, user.id);
    } catch (error) {
      if (error instanceof FoundationStaffReadError && error.status === 403)
        redirect("/staff/two-step");
      throw error;
    }
  })();
  const { allItems, totalWaiting, claims, myClaims, failedAreas } = result;
  const shownCount = allItems.length;

  return (
    <div className="min-w-0 w-full max-w-full space-y-6 overflow-x-hidden">
      <PageHeader
        title="Content moderation"
        description="Review and approve pending content."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Moderation" }]}
      >
        <Badge variant="outline" className="gap-1">
          {totalWaiting} pending
        </Badge>
      </PageHeader>

      {failedAreas.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Some moderation items could not be loaded for: {failedAreas.join(", ")}.
        </div>
      )}

      {totalWaiting > shownCount && (
        <p className="text-sm text-muted-foreground">
          Showing {shownCount} of {totalWaiting} waiting items: the oldest {SHOWN_PER_TYPE} of each
          kind, plus any you hold. Claiming always takes the oldest first, including those not
          shown.
        </p>
      )}

      <QueueClaimBar
        queue="content"
        myClaims={myClaims}
        canClaim={roleHasCapability(role, "queue:claim")}
      />

      <QueueClaimsProvider
        claims={claims}
        mustClaim={role === "moderator"}
        canFree={roleHasCapability(role, "decision:approve")}
      >
        <ModerationQueueClient items={allItems} />
      </QueueClaimsProvider>
    </div>
  );
}
