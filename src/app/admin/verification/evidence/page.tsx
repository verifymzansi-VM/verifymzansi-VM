import { requireStaff } from "@/lib/auth/require-staff";
import { redirect } from "next/navigation";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { PageHeader } from "@/components/layout/page-header";
import { EvidenceDeskClient } from "@/components/admin/evidence-desk";

export const metadata = {
  title: "Evidence desk — Admin",
  description: "Examine uploaded KYC evidence — ID documents and selfies.",
};

export default async function EvidenceDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ stepId?: string; userId?: string }>;
}) {
  await requireStaff("queue:view");

  // Feature flag check
  const evidenceDeskEnabled = await isFeatureEnabled("kyc_evidence_desk");
  if (!evidenceDeskEnabled) {
    redirect("/admin/verification");
  }

  const params = await searchParams;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence desk"
        description="Review encrypted KYC evidence."
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Verification", href: "/admin/verification" },
          { label: "Evidence desk" },
        ]}
      />

      <EvidenceDeskClient initialStepId={params.stepId} initialUserId={params.userId} />
    </div>
  );
}
