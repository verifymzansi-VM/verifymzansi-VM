import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { Badge } from "@/components/ui/badge";
import { OrganisationCreateForm } from "@/components/admin/commercial/organisation-forms";

export const metadata = { title: "Organisations" };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

export default async function OrganisationsAdminPage() {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  if (!(await verifyCapabilityFromDb(user, "organisations:manage"))) redirect("/admin");

  const admin = createAdminClient();
  const [orgs, sponsorships, affiliations, pending] = await Promise.all([
    admin
      .from("organisations")
      .select(
        "id, slug, name, organisation_type, programme_status, is_public, trial_ends_at, sponsored_capacity"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("organisation_sponsorships").select("organisation_id").eq("status", "active"),
    admin.from("organisation_affiliations").select("organisation_id").eq("status", "active"),
    admin.from("organisation_applications").select("organisation_id").eq("status", "submitted"),
  ]);
  if (orgs.error) throw new Error("Unable to load organisations");
  const count = (rows: Array<{ organisation_id: string }> | null, id: string) =>
    (rows ?? []).filter((row) => row.organisation_id === id).length;

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-2xl font-bold">Organisations</h1>
        <p className="text-sm text-muted-foreground">
          Founding Organisation Programme: invitation only, six months at no platform fee, capped
          sponsored cohort, no automatic renewal. Organisations confirm affiliation — they never
          award VerifyMzansi verification or change ranking.
        </p>
      </div>

      <OrganisationCreateForm />

      <section className="space-y-2">
        <h2 className="text-base font-semibold">All organisations</h2>
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
                    <dd>{count(affiliations.data, org.id)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Sponsored</dt>
                    <dd>
                      {count(sponsorships.data, org.id)} / {org.sponsored_capacity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pending</dt>
                    <dd>{count(pending.data, org.id)}</dd>
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
