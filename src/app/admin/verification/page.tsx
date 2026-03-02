import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { VerificationAlertBanner } from "@/components/admin/verification-alert-banner";
import { KycQueueClient } from "./kyc-queue-client";
import { getPendingVerifications } from "@/lib/utils/admin-queries";
import { isModeratorOrAdmin } from "@/lib/auth/roles";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

export const metadata = {
  title: "Verification Queue | Admin | VerifyMzansi",
};

export default async function AdminVerificationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isModeratorOrAdmin(user)) {
    redirect("/dashboard");
  }

  const pendingSteps = await getPendingVerifications(100);
  const evidenceDeskEnabled = await isFeatureEnabled("kyc_evidence_desk");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verification Queue"
        description="Review and process seller KYC verification requests."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Verification" }]}
      >
        <Badge variant="outline" className="gap-1">
          {pendingSteps.length} Pending
        </Badge>
      </PageHeader>

      <VerificationAlertBanner pendingCount={pendingSteps.length} />

      <KycQueueClient initialSteps={pendingSteps} evidenceDeskEnabled={evidenceDeskEnabled} />
    </div>
  );
}
