import Link from "next/link";
import { redirect } from "next/navigation";
import { FoundationOrganisationCreate } from "@/components/admin/foundation-organisation-create";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFoundationStaffOrganisations } from "@/lib/foundation/staff-directory";
import { FoundationOrganisationError } from "@/lib/foundation/organisations";
import { PageHeader } from "@/components/layout/page-header";
export async function FoundationOrganisationsPage() {
  const current = await readFoundationServerSession();
  if (!current.account.staff?.assigned_capabilities.includes("organisation:manage"))
    redirect("/admin");
  let organisations;
  try {
    organisations = await readFoundationStaffOrganisations(current.api);
  } catch (error) {
    if (error instanceof FoundationOrganisationError && error.reason === "forbidden")
      redirect("/staff/two-step?next=%2Fadmin%2Forganisations");
    throw error;
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        description="Manage programme profiles and organisation administrators."
      />
      <FoundationOrganisationCreate accountId={current.account.account_id} />
      <ul className="divide-y rounded-lg border">
        {organisations.map((org) => (
          <li key={org.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <Link className="font-semibold underline" href={`/admin/organisations/${org.id}`}>
              {org.name}
            </Link>
            <span>
              {org.programme_status.replaceAll("_", " ")} · {org.is_public ? "Public" : "Private"}
            </span>
          </li>
        ))}
      </ul>
      {!organisations.length && <p>No organisations have been created.</p>}
    </div>
  );
}
