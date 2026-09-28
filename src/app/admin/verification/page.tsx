import { requireStaff } from "@/lib/auth/require-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { countMyClaims, getClaimsForItems } from "@/lib/services/queue-claims";
import { QueueClaimBar, QueueClaimsProvider } from "@/components/admin/queue-claims";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { VerificationAlertBanner } from "@/components/admin/verification-alert-banner";
import { KycQueueClient } from "./kyc-queue-client";
import { getPendingVerificationGroups } from "@/lib/utils/admin-queries";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

export const metadata = {
  title: "Verification Queue — Admin",
  description: "Review pending identity verification submissions and make approval decisions.",
};

export default async function AdminVerificationPage() {
  const { user, role } = await requireStaff("queue:view");

  let pendingGroups: Awaited<ReturnType<typeof getPendingVerificationGroups>> = [];
  try {
    pendingGroups = await getPendingVerificationGroups(100);
  } catch {
    /* degrade gracefully — show empty queue */
  }
  const evidenceDeskEnabled = await isFeatureEnabled("kyc_evidence_desk");
  const pendingRequestCount = pendingGroups.reduce((count, group) => count + group.steps.length, 0);
  const [claims, myClaims] = await Promise.all([
    getClaimsForItems(
      user.id,
      pendingGroups.flatMap((group) =>
        group.steps.map((step) => ({ type: "verification_step" as const, id: step.id }))
      )
    ),
    countMyClaims(user.id, "kyc"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verification Queue"
        description="Claim verification requests to review them. Highest risk comes first."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Verification" }]}
      >
        <Badge variant="outline" className="gap-1">
          {pendingRequestCount} Pending
        </Badge>
      </PageHeader>

      <VerificationAlertBanner pendingCount={pendingRequestCount} />

      <QueueClaimBar
        queue="kyc"
        myClaims={myClaims}
        canClaim={roleHasCapability(role, "queue:claim")}
      />

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
