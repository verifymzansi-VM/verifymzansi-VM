import { notFound } from "next/navigation";

import { CaseReview } from "@/components/admin/business-verification/case-review";
import { QueueClaimsProvider } from "@/components/admin/queue-claims";
import { PageHeader } from "@/components/layout/page-header";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { requireStaff } from "@/lib/auth/require-staff";
import { getCaseDetail } from "@/lib/business-verification/admin-queries";
import { getClaimsForItems } from "@/lib/services/queue-claims";

export const metadata = {
  title: "Business verification case — Admin",
  description: "Review one business verification case.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BusinessVerificationCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, role } = await requireStaff("queue:view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const detail = await getCaseDetail(id);
  if (!detail) notFound();

  const name = detail.business?.business_name ?? "Business";
  if (detail.ownerId === user.id) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={name}
          breadcrumbs={[
            { label: "Admin", href: "/admin" },
            { label: "Business verification", href: "/admin/business-verification" },
            { label: name },
          ]}
        />
        <p role="alert">This is your own business. Another staff member must review it.</p>
      </div>
    );
  }

  const claims = await getClaimsForItems(user.id, [{ type: "business_verification", id }]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={name}
        description={detail.kind === "seen" ? "Seen by VerifyMzansi" : "CIPC registered"}
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Business verification", href: "/admin/business-verification" },
          { label: name },
        ]}
      />
      <QueueClaimsProvider
        claims={claims}
        mustClaim={role === "moderator"}
        canFree={roleHasCapability(role, "decision:approve")}
      >
        <CaseReview
          detail={detail}
          viewerId={user.id}
          canDecideSenior={roleHasCapability(role, "decision:approve")}
        />
      </QueueClaimsProvider>
    </div>
  );
}
