import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import {
  AffiliationRequestPanel,
  type MemberApplication,
  type MemberAffiliation,
} from "@/components/organisations/affiliation-request-panel";
import { SHARED_WITH_ORGANISATION } from "@/lib/organisations/affiliations";

export const metadata = { title: "Organisation affiliations" };
export const dynamic = "force-dynamic";

export default async function AffiliationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?returnUrl=/dashboard/affiliations");

  const db = createAdminClient();
  const [businesses, applications, adminOf] = await Promise.all([
    db
      .from("businesses")
      .select("id, business_name, status")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
    db
      .from("organisation_applications")
      .select(
        "id, organisation_id, business_id, status, info_request, decision_note, created_at, organisations(name, slug)"
      )
      .eq("applicant_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("organisation_admins")
      .select("organisations(name, slug, programme_status)")
      .eq("user_id", user.id),
  ]);
  const businessIds = (businesses.data ?? []).map((b) => b.id);
  const affiliations = businessIds.length
    ? await db
        .from("organisation_affiliations")
        .select(
          "id, organisation_id, business_id, confirmed_at, organisations(name, slug, affiliation_wording)"
        )
        .in("business_id", businessIds)
        .eq("status", "active")
    : { data: [] };

  const administered = (adminOf.data ?? [])
    .map(
      (row) =>
        row.organisations as unknown as {
          name: string;
          slug: string;
          programme_status: string;
        } | null
    )
    .filter((org): org is { name: string; slug: string; programme_status: string } =>
      Boolean(org && org.programme_status !== "ended")
    );

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Organisation affiliations"
        description="Show that your business participates in a municipal, chamber, tourism or enterprise programme. Affiliation is optional — your VerifyMzansi account works the same without it."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Affiliations" }]}
      />

      {administered.length > 0 ? (
        <section className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-4 text-sm">
          <p className="font-semibold">Organisations you administer</p>
          <ul className="mt-2 flex flex-wrap gap-3">
            {administered.map((org) => (
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
        businesses={(businesses.data ?? []).map((b) => ({
          id: b.id,
          name: b.business_name,
          status: b.status,
        }))}
        applications={(applications.data ?? []) as unknown as MemberApplication[]}
        affiliations={(affiliations.data ?? []) as unknown as MemberAffiliation[]}
        sharedFields={[...SHARED_WITH_ORGANISATION]}
      />
    </div>
  );
}
