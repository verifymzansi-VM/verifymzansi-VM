import { requireStaff } from "@/lib/auth/require-staff";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { OrganisationCreateForm } from "@/components/admin/commercial/organisation-forms";

import { redirect } from "next/navigation";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { readFrontendStaffOrganisationDirectory } from "@/lib/foundation/staff-organisations";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";

export const metadata = { title: "Organisations" };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeZone: "Africa/Johannesburg",
});

async function readNativeDirectory() {
  const { api } = await readFoundationServerSession();
  const { total, items } = await readFrontendStaffOrganisationDirectory(api).catch(
    (error: unknown) => {
      if (error instanceof FoundationStaffCommandError && error.mfaRequired)
        redirect(staffVerifyHref("/staff/two-step", "/admin/organisations"));
      throw error;
    }
  );
  return {
    total,
    items: items.map((row) => ({ ...row, trial_ends_at: row.ends_at })),
    countError: false,
  };
}

export default async function OrganisationsAdminPage() {
  await requireStaff("organisations:manage");
  const { total, items, countError } = await readNativeDirectory();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisations"
        description="Founding Organisation Programme: invitation only, 90 days at no platform fee, capped sponsored cohort, no automatic renewal. Organisations confirm affiliation; they never award VerifyMzansi verification or change ranking."
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
        {total > items.length && (
          <p className="text-sm text-muted-foreground">
            Showing the newest {items.length} of {total} organisations.
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No organisations yet.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((org) => (
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
                    <dd>{org.affiliated}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Sponsored</dt>
                    <dd>
                      {org.sponsored} / {org.sponsored_capacity}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Pending</dt>
                    <dd>{org.pending}</dd>
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
