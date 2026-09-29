import { requireStaff } from "@/lib/auth/require-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { countMyClaims, getClaimsForItems, getMyClaimedItems } from "@/lib/services/queue-claims";
import { QueueClaimBar, QueueClaimsProvider } from "@/components/admin/queue-claims";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { VerificationAlertBanner } from "@/components/admin/verification-alert-banner";
import { KycQueueClient } from "./kyc-queue-client";
import { countPendingVerifications, getPendingVerificationGroups } from "@/lib/utils/admin-queries";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { createLogger } from "@/lib/utils/logger";

export const metadata = {
  title: "Verify accounts — Admin",
  description: "Review pending identity verification submissions and make approval decisions.",
};

const SHOWN_LIMIT = 100;

export default async function AdminVerificationPage() {
  const { user, role } = await requireStaff("queue:view");

  const myClaimed = await getMyClaimedItems(user.id, "kyc");
  let loaded: [Awaited<ReturnType<typeof getPendingVerificationGroups>>, number, boolean, number];
  try {
    loaded = await Promise.all([
      getPendingVerificationGroups(SHOWN_LIMIT, { includeIds: myClaimed.map((c) => c.id) }),
      countPendingVerifications(),
      isFeatureEnabled("kyc_evidence_desk"),
      countMyClaims(user.id, "kyc"),
    ]);
  } catch (error) {
    createLogger("AdminVerificationPage").error("Verification queue read failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return (
      <p role="alert">
        The verification queue could not be loaded. Refresh to try again. This does not mean the
        queue is empty.
      </p>
    );
  }
  const [pendingGroups, totalPending, evidenceDeskEnabled, myClaims] = loaded;
  const shownCount = pendingGroups.reduce((count, group) => count + group.steps.length, 0);
  const claims = await getClaimsForItems(
    user.id,
    pendingGroups.flatMap((group) =>
      group.steps.map((step) => ({ type: "verification_step" as const, id: step.id }))
    )
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verify accounts"
        description="Claim verification requests to review them. Highest risk comes first."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Verification" }]}
      >
        <Badge variant="outline" className="gap-1">
          {totalPending} pending
        </Badge>
      </PageHeader>

      <VerificationAlertBanner pendingCount={totalPending} />

      <QueueClaimBar
        queue="kyc"
        myClaims={myClaims}
        canClaim={roleHasCapability(role, "queue:claim")}
      />

      {totalPending > shownCount && (
        <p className="text-sm text-muted-foreground">
          Showing {shownCount} of {totalPending} pending checks: the oldest, plus any you hold.
          Claiming always takes the highest-risk checks first, including those not shown.
        </p>
      )}

      <QueueClaimsProvider
        claims={claims}
        mustClaim={role === "moderator"}
        canFree={roleHasCapability(role, "decision:approve")}
      >
        <KycQueueClient initialGroups={pendingGroups} evidenceDeskEnabled={evidenceDeskEnabled} />
      </QueueClaimsProvider>
    </div>
  );
}
