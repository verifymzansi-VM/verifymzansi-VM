import { notFound, redirect } from "next/navigation";
import { FoundationOrganisationEditor } from "@/components/admin/foundation-organisation-editor";
import { PageHeader } from "@/components/layout/page-header";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationStaffOrganisation } from "@/lib/foundation/staff-organisations";
import { FoundationOrganisationError } from "@/lib/foundation/organisations";
import { readFoundationReferenceCatalogue } from "@/lib/foundation/reference-catalogue";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
export async function FoundationOrganisationDetail({ id }: { id: string }) {
  const current = await readFoundationServerSession();
  if (!current.account.staff?.assigned_capabilities.includes("organisation:manage"))
    redirect("/admin");
  let organisation;
  try {
    organisation = await readFoundationStaffOrganisation(current.api, { id });
  } catch (error) {
    if (error instanceof FoundationOrganisationError && error.reason === "forbidden")
      redirect(`/staff/two-step?next=${encodeURIComponent(`/admin/organisations/${id}`)}`);
    throw error;
  }
  if (!organisation) notFound();
  const catalogue = await readFoundationReferenceCatalogue(foundationServerPublicApi());
  return (
    <div className="space-y-6">
      <PageHeader
        title={organisation.name}
        description="Manage its programme, public profile and administrators."
      />
      <FoundationOrganisationEditor
        accountId={current.account.account_id}
        organisation={organisation}
        provinces={catalogue.provinces}
      />
    </div>
  );
}
