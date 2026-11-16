import { notFound, redirect } from "next/navigation";

import { CaseReview } from "@/components/admin/business-verification/case-review";
import { QueueClaimsProvider } from "@/components/admin/queue-claims";
import { PageHeader } from "@/components/layout/page-header";
import { roleHasCapability } from "@/lib/auth/admin-access";
import { requireStaff } from "@/lib/auth/require-staff";
import type { CaseDetail } from "@/lib/business-verification/admin-queries";
import { getClaimsForItems } from "@/lib/services/queue-claims";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readStaffSeenCase } from "@/lib/foundation/business-seen";
import { readStaffCipcCase } from "@/lib/foundation/business-cipc";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { suggestNextStep } from "@/lib/cipc/screen";

export const metadata = {
  title: "Business verification case — Admin",
  description: "Review one business verification case.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readNativeDetail(id: string): Promise<CaseDetail> {
  const { api } = await readFoundationServerSession();
  let data;
  try {
    data = await readStaffSeenCase(api, id);
    if (!data) return await readStaffCipcCase(api, id);
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", `/admin/business-verification/${id}`));
    throw error;
  }
  if (!data) return null;
  return {
    ...data,
    route: null,
    registrationNumber: null,
    docType: null,
    business: { ...data.business, cipc_verified_at: null, cipc_registration_number: null },
    owner: { ...data.owner, hasIdHash: false },
    parsed: {
      registeredName: null,
      registrationNumber: null,
      enterpriseStatus: null,
      issuedOn: null,
      registeredOfficeLines: [],
      directors: [],
    },
    ownerMatchOnUpload: null,
    adminCopy: null,
    registeredOffice: null,
    representative: null,
    checks: null,
    findings: [],
    suggestion: suggestNextStep([], false),
    evidence: null,
    files: data.files.map((file) => ({ ...file, producer: null, revision_count: null })),
    accessLog: [],
  };
}

export default async function BusinessVerificationCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, role } = await requireStaff("queue:view");
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const detail = await readNativeDetail(id.toLowerCase());
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
