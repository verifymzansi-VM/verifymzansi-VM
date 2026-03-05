import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { PageHeader } from "@/components/layout/page-header";
import dynamic from "next/dynamic";
import { isModeratorOrAdmin } from "@/lib/auth/roles";

const EvidenceDeskClient = dynamic(
  () => import("@/components/admin/evidence-desk").then((m) => m.EvidenceDeskClient),
  {
    loading: () => (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    ),
  }
);

export const metadata = {
  title: "Evidence Desk — Admin",
  description: "Examine uploaded KYC evidence — ID documents, selfies, and location proofs.",
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
        description="Review encrypted KYC evidence."
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
