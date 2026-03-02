import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { PageHeader } from "@/components/layout/page-header";
import { EvidenceDeskClient } from "@/components/admin/evidence-desk";
import { isModeratorOrAdmin } from "@/lib/auth/roles";

export const metadata = {
  title: "Evidence Desk | Admin | VerifyMzansi",
};

export default async function EvidenceDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ stepId?: string; userId?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isModeratorOrAdmin(user)) {
    redirect("/dashboard");
  }

  // Feature flag check
  const evidenceDeskEnabled = await isFeatureEnabled("kyc_evidence_desk");
  if (!evidenceDeskEnabled) {
    redirect("/admin/verification");
  }

  const params = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence Desk"
        description="View and review encrypted KYC evidence for verification decisions."
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Verification", href: "/admin/verification" },
          { label: "Evidence Desk" },
        ]}
      />

      <EvidenceDeskClient initialStepId={params.stepId} initialUserId={params.userId} />
    </div>
  );
}
