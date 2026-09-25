import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import {
  OrganisationActionsForm,
  OrganisationProfileForm,
  ShowcaseToggle,
  type AdminOrganisation,
} from "@/components/admin/commercial/organisation-forms";
import {
  ApplicationsReview,
  MembersManager,
  type OrganisationApplicationRow,
  type OrganisationMemberRow,
} from "@/components/organisations/organisation-management";
import {
  PerformanceReport,
  parsePerformanceReport,
} from "@/components/organisations/performance-report";

export const metadata = { title: "Organisation" };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Africa/Johannesburg",
});

/** Report from the pilot start (or the last 90 days) until now. */
function reportWindow(startedAt: string | null): { from: string; to: string } {
  const now = new Date();
  return {
    from: startedAt ?? new Date(now.getTime() - 90 * 86_400_000).toISOString(),
    to: now.toISOString(),
  };
}

export default async function OrganisationAdminDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login");
  if (!(await verifyCapabilityFromDb(user, "organisations:manage"))) redirect("/admin");

  const admin = createAdminClient();
  const { data: org } = await admin.from("organisations").select("*").eq("id", id).maybeSingle();
  if (!org) notFound();

  const { from: reportFrom, to: reportTo } = reportWindow(org.trial_starts_at);
  const [applications, members, admins, notes, programmes, showcases, audit, report] =
    await Promise.all([
      admin.rpc("org_list_applications", { p_user: user.id, p_org: id, p_status: null }),
      admin.rpc("org_list_members", { p_user: user.id, p_org: id }),
      admin
        .from("organisation_admins")
        .select("user_id, role, created_at")
        .eq("organisation_id", id),
      admin
        .from("organisation_notes")
        .select("id, note, created_at")
        .eq("organisation_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      admin
        .from("organisation_programmes")
        .select("id, name, slug, active")
        .eq("organisation_id", id),
      admin
        .from("programme_showcases")
        .select("id, title, placement, enabled, ends_at")
        .eq("organisation_id", id),
      admin
        .from("audit_logs")
        .select("id, action, actor_role, reason, created_at")
        .eq("target_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
      admin.rpc("organisation_performance_report", {
        p_user: user.id,
        p_org: id,
        p_from: reportFrom,
        p_to: reportTo,
      }),
    ]);

  const adminIds = (admins.data ?? []).map((row) => row.user_id);
  const adminProfiles = adminIds.length
    ? await admin.from("account_profiles").select("user_id, display_name").in("user_id", adminIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const parsedReport = parsePerformanceReport(report.data);

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
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <OrganisationActionsForm org={org as AdminOrganisation} />
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-base font-semibold">
            Administrators ({adminIds.length} / {org.admin_limit})
          </h2>
          <ul className="space-y-1 text-sm">
            {(admins.data ?? []).map((row) => (
              <li key={row.user_id} className="break-all">
                {(adminProfiles.data ?? []).find((p) => p.user_id === row.user_id)?.display_name ??
                  "Account"}{" "}
                — {row.role} · <span className="text-muted-foreground">{row.user_id}</span>
              </li>
            ))}
          </ul>
          <h2 className="pt-2 text-base font-semibold">Programmes</h2>
          <ul className="text-sm">
            {(programmes.data ?? []).map((p) => (
              <li key={p.id}>
                {p.name} {p.active ? "" : "(inactive)"}
              </li>
            ))}
            {(programmes.data ?? []).length === 0 ? (
              <li className="text-muted-foreground">None yet</li>
            ) : null}
          </ul>
          <h2 className="pt-2 text-base font-semibold">Programme showrooms</h2>
          <ul className="space-y-2 text-sm">
            {(showcases.data ?? []).map((s) => (
              <li key={s.id} className="space-y-1">
                <p>
                  {s.title} · {s.placement} · {s.enabled ? "enabled" : "disabled"} · until{" "}
                  {date.format(new Date(s.ends_at))}
                </p>
                <ShowcaseToggle orgId={org.id} showcase={s} />
              </li>
            ))}
            {(showcases.data ?? []).length === 0 ? (
              <li className="text-muted-foreground">None configured</li>
            ) : null}
          </ul>
          <h2 className="pt-2 text-base font-semibold">Internal notes</h2>
          <ul className="space-y-1 text-sm">
            {(notes.data ?? []).map((n) => (
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
        <ApplicationsReview
          organisationId={org.id}
          applications={(applications.data ?? []) as OrganisationApplicationRow[]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Affiliated and sponsored businesses</h2>
        <MembersManager
          organisationId={org.id}
          members={(members.data ?? []) as OrganisationMemberRow[]}
          sponsoredCapacity={org.sponsored_capacity}
          canSponsor={["founding_trial", "active_paid"].includes(org.programme_status)}
          allowFoundingSponsorship={org.programme_status === "founding_trial"}
        />
      </section>

      {parsedReport ? (
        <PerformanceReport organisationName={org.name} report={parsedReport} />
      ) : null}

      <OrganisationProfileForm org={org as AdminOrganisation} />

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Audit history</h2>
        <ul className="space-y-1 text-sm">
          {(audit.data ?? []).map((row) => (
            <li key={row.id}>
              <span className="text-muted-foreground">{date.format(new Date(row.created_at))}</span>{" "}
              · {row.action.replace(/_/g, " ")} by {row.actor_role}
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
