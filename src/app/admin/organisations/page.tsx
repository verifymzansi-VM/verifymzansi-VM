import { requireStaff } from "@/lib/auth/require-staff";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { OrganisationCreateForm } from "@/components/admin/commercial/organisation-forms";

export const metadata = { title: "Organisations" };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

export default async function OrganisationsAdminPage() {
  await requireStaff("organisations:manage");

  const admin = createAdminClient();
  const orgs = await admin
    .from("organisations")
    .select(
      "id, slug, name, organisation_type, programme_status, is_public, trial_ends_at, sponsored_capacity",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (orgs.error) throw new Error("Unable to load organisations");

  // Counts for the organisations shown, computed in the database.
  const ids = (orgs.data ?? []).map((org) => org.id);
  const { data: countRows, error: countError } = ids.length
    ? await admin.rpc("organisation_list_counts", { p_ids: ids })
    : { data: [], error: null };
  const counts = new Map(
    (
      (countRows ?? []) as Array<{
        organisation_id: string;
        affiliated: number;
        sponsored: number;
        pending: number;
      }>
    ).map((row) => [row.organisation_id, row] as const)
  );
  const countOf = (id: string, key: "affiliated" | "sponsored" | "pending") =>
    countError ? "—" : (counts.get(id)?.[key] ?? 0);
  const total = orgs.count ?? ids.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        description="Founding Organisation Programme: invitation only, six months at no platform fee, capped sponsored cohort, no automatic renewal. Organisations confirm affiliation; they never award VerifyMzansi verification or change ranking."
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Organisations" }]}
      />

      <OrganisationCreateForm />

      <section className="space-y-2">
        <h2 className="text-base font-semibold">All organisations</h2>
        {countError && (
          <p role="alert" className="text-sm text-destructive">
            Member counts could not be loaded, so they show as —. Refresh to try again.
          </p>
        )}
        {total > ids.length && (
          <p className="text-sm text-muted-foreground">
            Showing the newest {ids.length} of {total} organisations.
          </p>
        )}
        {(orgs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No organisations yet.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {(orgs.data ?? []).map((org) => (
              <li key={org.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/organisations/${org.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {org.name}
                  </Link>
                  <Badge variant="outline">{org.programme_status.replace(/_/g, " ")}</Badge>
                  {org.is_public ? <Badge variant="secondary">Public</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {org.organisation_type.replace(/_/g, " ")} · /organisation/{org.slug}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Affiliated</dt>
                    <dd>{countOf(org.id, "affiliated")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Sponsored</dt>
                    <dd>
                      {countOf(org.id, "sponsored")} / {org.sponsored_capacity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pending</dt>
                    <dd>{countOf(org.id, "pending")}</dd>
                  </div>
                </dl>
                {org.trial_ends_at ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Pilot ends {date.format(new Date(org.trial_ends_at))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
