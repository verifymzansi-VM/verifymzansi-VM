import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { VerificationAlertBanner } from "@/components/admin/verification-alert-banner";
import { KycQueueClient } from "./kyc-queue-client";
import { getPendingVerificationGroups } from "@/lib/utils/admin-queries";
import { isStaff } from "@/lib/auth/roles";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

export const metadata = {
  title: "Verification Queue — Admin",
  description: "Review pending identity verification submissions and make approval decisions.",
};

export default async function AdminVerificationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isStaff(user)) {
    redirect("/dashboard");
  }

  const pendingGroups = await getPendingVerificationGroups(100);
  const evidenceDeskEnabled = await isFeatureEnabled("kyc_evidence_desk");
  const pendingRequestCount = pendingGroups.reduce((count, group) => count + group.steps.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verification Queue"
        description="Review account KYC verification requests."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Verification" }]}
      >
        <Badge variant="outline" className="gap-1">
          {pendingRequestCount} Pending
        </Badge>
      </PageHeader>

      <VerificationAlertBanner pendingCount={pendingRequestCount} />

      <KycQueueClient initialGroups={pendingGroups} evidenceDeskEnabled={evidenceDeskEnabled} />
    </div>
  );
}
