import { redirect } from "next/navigation";
import { FoundationPartners } from "@/components/admin/foundation-partners";
import { PageHeader } from "@/components/layout/page-header";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import {
  readFoundationStaffPartners,
  readFoundationStaffCommissions,
} from "@/lib/foundation/staff-directory";
import { FoundationOrganisationError } from "@/lib/foundation/organisations";
export async function FoundationPartnersPage() {
  const current = await readFoundationServerSession();
  if (!current.account.staff?.assigned_capabilities.includes("partner:manage")) redirect("/admin");
  let result;
  try {
    result = await Promise.all([
      readFoundationStaffPartners(current.api),
      readFoundationStaffCommissions(current.api, {}),
    ]);
  } catch (error) {
    if (error instanceof FoundationOrganisationError && error.reason === "forbidden")
      redirect("/staff/two-step?next=%2Fadmin%2Fpartners");
    throw error;
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Partners and commissions"
        description="Manage referral accounts and their audited commission records."
      />
      <FoundationPartners
        accountId={current.account.account_id}
        partners={result[0]}
        commissions={result[1]}
      />
    </div>
  );
}
