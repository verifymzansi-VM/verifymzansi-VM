import { requireStaff } from "@/lib/auth/require-staff";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  OrganisationActionsForm,
  OrganisationProfileForm,
  ShowcaseToggle,
  type AdminOrganisation,
} from "@/components/admin/commercial/organisation-forms";
import {
  ApplicationsReview,
  MembersManager,
} from "@/components/organisations/organisation-management";
import {
  PerformanceReport,
  parsePerformanceReport,
} from "@/components/organisations/performance-report";
import { OrganisationInvitesCard } from "@/components/admin/commercial/organisation-invites";

import { z } from "zod";
import { staffVerifyHref } from "@/lib/auth/staff-mfa-links";
import { readFoundationOrganisationManagementData } from "@/lib/foundation/organisation-management-data";
import { foundationMediaUrl } from "@/lib/foundation/public-media-url";
import { readRestoredStaffAudit } from "@/lib/foundation/restored-staff-audit";
import { readFoundationServerSession } from "@/lib/foundation/server-session";
import { FoundationStaffCommandError } from "@/lib/foundation/staff-command";
import { readFoundationStaffShowcases } from "@/lib/foundation/staff-directory";
import { readFrontendStaffOrganisationDetail } from "@/lib/foundation/staff-organisations";

export const metadata = { title: "Organisation" };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

async function readNativeDetail(id: string) {
  try {
    const { api, user } = await readFoundationServerSession();
    const org = await readFrontendStaffOrganisationDetail(api, id);
    if (!org) notFound();
    const [management, showcases, audit] = await Promise.all([
      readFoundationOrganisationManagementData(api, id, org.public_contacts),
      readFoundationStaffShowcases(api, { organisation_id: id }),
      readRestoredStaffAudit(api, user.id, { page: 1, type: "organisation", target: id }),
    ]);
    return {
      org: {
        id: org.id,
        revision: org.revision,
        slug: org.slug,
        name: org.name,
        organisation_type: org.organisation_type,
        description: org.description,
        programme_description: org.programme_description,
        service_area: org.service_area,
        website: org.website,
        public_email: org.public_email,
        public_phone: org.public_phone,
        logo_permission_at: org.logo_permission_at,
        logo_permission_reference: org.logo_permission_reference,
        programme_status: org.programme_status,
        is_public: org.is_public,
        accepting_applications: org.accepting_applications,
        affiliation_wording: org.affiliation_wording,
        sponsorship_wording: org.sponsorship_wording,
        sponsored_capacity: org.sponsored_capacity,
        admin_limit: org.admin_limit,
        show_on_strip: org.show_on_strip,
        show_on_home: org.show_on_home,
        display_order: org.display_order,
        trial_starts_at: org.programme_starts_at,
        trial_ends_at: org.programme_ends_at,
        province: org.province_id,
        logo_url: org.logo_permission_at ? foundationMediaUrl(org.logo_object_key) : null,
      } satisfies AdminOrganisation,
      applications: management.applications,
      members: management.members,
      admins: org.admins.map((row) => ({ ...row, user_id: row.account_id })),
      notes: org.notes.slice(0, 20),
      programmes: org.programmes,
      showcases,
      audit: audit.items.slice(0, 30).map((row) => ({
        ...row,
        actor_label: row.actor_name ?? "Account",
        created_at: row.occurred_at,
      })),
      report: null,
      openInvites: org.open_invites,
    };
  } catch (error) {
    if (error instanceof FoundationStaffCommandError && error.mfaRequired)
      redirect(staffVerifyHref("/staff/two-step", `/admin/organisations/${id}`));
    throw error;
  }
}

export default async function OrganisationAdminDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff("organisations:manage");
  const id = (await params).id.toLowerCase();
  if (!z.uuid().safeParse(id).success) notFound();
  const {
    org,
    applications,
    members,
    admins,
    notes,
    programmes,
    showcases,
    audit,
    report,
    openInvites,
  } = await readNativeDetail(id);
  const parsedReport = parsePerformanceReport(report);
  const seatsLeft = Math.max(0, org.admin_limit - admins.length - openInvites.length);

  return (
    <div className="space-y-6 p-4">
      <div>
        <Link href="/admin/organisations" className="text-sm underline">
          ← Organisations
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{org.name}</h1>
        <p className="text-sm text-muted-foreground">
          {org.programme_status.replace(/_/g, " ")} ·{" "}
          {org.is_public ? (
            <Link className="underline" href={`/organisation/${org.slug}`} target="_blank">
              /organisation/{org.slug}
            </Link>
          ) : (
            "private profile"
          )}
          {org.trial_ends_at ? ` · pilot ends ${date.format(new Date(org.trial_ends_at))}` : ""}
          {org.logo_permission_at
            ? ` · logo permission recorded (${org.logo_permission_reference ?? "no reference"})`
            : " · no logo permission"}
        </p>
        {org.programme_status === "founding_trial" ? (
          <p className="mt-1 text-sm">
            <Link className="underline" href={`/admin/trials?offer=organisation_trial:${org.id}`}>
              Offer a pilot extension
            </Link>{" "}
            <span className="text-muted-foreground">
              (applies only if the programme owner accepts)
            </span>
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <OrganisationActionsForm org={org} />
          <OrganisationInvitesCard
            organisationId={org.id}
            invites={openInvites}
            seatsLeft={seatsLeft}
          />
        </div>
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold">
            Administrators ({admins.length} / {org.admin_limit})
          </h2>
          <ul className="space-y-1 text-sm">
            {admins.map((row) => (
              <li key={row.user_id} className="break-all">
                {row.display_name ?? "Account"} — {row.role} ·{" "}
                <span className="text-muted-foreground">{row.user_id}</span>
              </li>
            ))}
          </ul>
          <h2 className="pt-2 text-base font-semibold">Programmes</h2>
          <ul className="text-sm">
            {programmes.map((p) => (
              <li key={p.id}>
                {p.name} {p.active ? "" : "(inactive)"}
              </li>
            ))}
            {programmes.length === 0 ? <li className="text-muted-foreground">None yet</li> : null}
          </ul>
          <h2 className="pt-2 text-base font-semibold">Programme showrooms</h2>
          <ul className="space-y-2 text-sm">
            {showcases.map((s) => (
              <li key={s.id} className="space-y-1">
                <p>
                  {s.title} · {s.placement} · {s.enabled ? "enabled" : "disabled"} · until{" "}
                  {date.format(new Date(s.ends_at))}
                </p>
                <ShowcaseToggle orgId={org.id} showcase={s} />
              </li>
            ))}
            {showcases.length === 0 ? (
              <li className="text-muted-foreground">None configured</li>
            ) : null}
          </ul>
          <h2 className="pt-2 text-base font-semibold">Internal notes</h2>
          <ul className="space-y-1 text-sm">
            {notes.map((n) => (
              <li key={n.id}>
                <span className="text-muted-foreground">
                  {date.format(new Date(n.created_at))}:{" "}
                </span>
                {n.note}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Affiliation applications</h2>
        <ApplicationsReview organisationId={org.id} applications={applications} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Affiliated and sponsored businesses</h2>
        <MembersManager
          organisationId={org.id}
          members={members}
          sponsoredCapacity={org.sponsored_capacity}
          canSponsor={["founding_trial", "active_paid"].includes(org.programme_status)}
          allowFoundingSponsorship={org.programme_status === "founding_trial"}
        />
      </section>

      {parsedReport ? (
        <PerformanceReport organisationName={org.name} report={parsedReport} />
      ) : null}

      <OrganisationProfileForm org={org} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Audit history</h2>
        <ul className="space-y-1 text-sm">
          {audit.map((row) => (
            <li key={row.id}>
              <span className="text-muted-foreground">{date.format(new Date(row.created_at))}</span>{" "}
              · {row.action.replace(/_/g, " ")} by {row.actor_label}
              {row.reason ? ` — ${row.reason}` : ""}
            </li>
          ))}
        </ul>
        <Link className="text-sm underline" href={`/admin/audit-log?target=${org.id}`}>
          Full audit log
        </Link>
      </section>
    </div>
  );
}
