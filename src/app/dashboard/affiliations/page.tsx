import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { AffiliationRequestPanel } from "@/components/organisations/affiliation-request-panel";
import { SHARED_WITH_ORGANISATION } from "@/lib/organisations/affiliations";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readAffiliationWorkspace } from "@/lib/foundation/affiliation-workspace";

export const metadata = { title: "Organisation affiliations" };
export const dynamic = "force-dynamic";

async function readNativeWorkspace(orgSlug: string | null) {
  const { api, user } = await readFoundationServerSession();
  const result = await readAffiliationWorkspace(api, orgSlug ?? undefined);
  if (result.account_id !== user.id) throw new Error("Current account changed");
  return result;
}

export default async function AffiliationsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: orgParam } = await searchParams;
  const orgSlug =
    orgParam && orgParam.length <= 80 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(orgParam)
      ? orgParam
      : null;
  const data = await readNativeWorkspace(orgSlug);
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Organisation affiliations"
        description="Show that your business participates in a municipal, chamber, tourism or enterprise programme. Affiliation is optional — your VerifyMzansi account works the same without it."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Affiliations" }]}
      />

      {data.administered.length > 0 ? (
        <section className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-4 text-sm">
          <p className="font-semibold">Organisations you administer</p>
          <ul className="mt-2 flex flex-wrap gap-3">
            {data.administered.map((org) => (
              <li key={org.slug}>
                <Link className="underline" href={`/dashboard/organisation/${org.slug}`}>
                  {org.name} dashboard
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AffiliationRequestPanel
        businesses={data.businesses}
        applications={data.applications}
        affiliations={data.affiliations}
        sharedFields={[...SHARED_WITH_ORGANISATION]}
        preselect={data.preselected}
      />
    </div>
  );
}
