import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCommercialSettings } from "@/lib/commercial/settings";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { ExtensionOfferCard } from "@/components/trials/extension-offer-card";
import { getOpenOfferForOrganisation } from "@/lib/trials/extension-offers";

export const metadata = { title: "Organisation dashboard", robots: { index: false } };
export const dynamic = "force-dynamic";

const date = new Intl.DateTimeFormat("en-ZA", {
  dateStyle: "long",
  timeZone: "Africa/Johannesburg",
});

type Summary = {
  programmeStatus: string;
  trialEndsAt: string | null;
  sponsoredCapacity: number;
  adminLimit: number;
  pending: number;
  moreInfo: number;
  approved: number;
  declined: number;
  affiliated: number;
  sponsored: number;
  waitlisted: number;
  daysRemaining: number | null;
};

function reportWindow(startedAt: string | null) {
  const now = new Date();
  return {
    from: startedAt ?? new Date(now.getTime() - 90 * 86_400_000).toISOString(),
    to: now.toISOString(),
  };
}

/**
 * Organisation administrators see only their own organisation. Every RPC
 * re-checks membership; nothing here exposes VerifyMzansi internal data.
 */
export default async function OrganisationDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?returnUrl=${encodeURIComponent(`/dashboard/organisation/${slug}`)}`);

  const db = createAdminClient();
  const { data: org } = await db
    .from("organisations")
    .select(
      "id, slug, name, programme_status, trial_starts_at, trial_ends_at, is_public, affiliation_wording"
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!org) notFound();
  const { data: isAdmin } = await db.rpc("is_organisation_admin", {
    p_org: org.id,
    p_user: user.id,
  });
  if (isAdmin !== true) notFound();

  const window = reportWindow(org.trial_starts_at);
  const [summary, applications, members, admins, report, settings, offer] = await Promise.all([
    db.rpc("organisation_admin_summary", { p_user: user.id, p_org: org.id }),
    db.rpc("org_list_applications", { p_user: user.id, p_org: org.id, p_status: null }),
    db.rpc("org_list_members", { p_user: user.id, p_org: org.id }),
    db.from("organisation_admins").select("user_id, role").eq("organisation_id", org.id),
    db.rpc("organisation_performance_report", {
      p_user: user.id,
      p_org: org.id,
      p_from: window.from,
      p_to: window.to,
    }),
    getCommercialSettings(db as never),
    getOpenOfferForOrganisation(org.id).catch(() => null),
  ]);
  const s = (summary.data ?? {}) as Partial<Summary>;
  const adminIds = (admins.data ?? []).map((a) => a.user_id);
  const adminProfiles = adminIds.length
    ? await db.from("account_profiles").select("user_id, display_name").in("user_id", adminIds)
    : { data: [] as Array<{ user_id: string; display_name: string | null }> };
  const parsedReport = parsePerformanceReport(report.data);
  // Alerts start at the earliest configured threshold (default 60/30/14/7 days).
  const alertFrom = Math.max(...settings.founding_organisation.alertDays);
  const showAlert =
    s.programmeStatus === "founding_trial" &&
    typeof s.daysRemaining === "number" &&
    s.daysRemaining <= alertFrom;
  // Trial expiry moves the organisation to affiliation-only (see organisation_lifecycle).
  const pilotEnded =
    s.programmeStatus === "affiliation_only" && Boolean(s.trialEndsAt) && s.daysRemaining === 0;
  const isOwner = (admins.data ?? []).some((a) => a.user_id === user.id && a.role === "owner");
  const capacity = s.sponsoredCapacity ?? 0;
  const filled = s.sponsored ?? 0;
  const waiting = s.waitlisted ?? 0;
  const fillPercent = capacity > 0 ? Math.min(100, Math.round((filled / capacity) * 100)) : 0;
  const reportFrom = window.from.slice(0, 10);

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title={`${org.name}`}
        description="Confirm programme participants, manage sponsored businesses and track engagement."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Affiliations", href: "/dashboard/affiliations" },
          { label: org.name },
        ]}
      />

      {showAlert ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-brand-gold-300 bg-brand-gold-50 p-4 text-sm dark:border-brand-gold-400/30 dark:bg-brand-gold-400/10"
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
          />
          <p>
            Your founding pilot ends in <strong>{s.daysRemaining} days</strong>
            {s.trialEndsAt ? ` (${date.format(new Date(s.trialEndsAt))})` : ""}. There is no
            automatic charge or renewal. Review your performance report and{" "}
            <Link className="underline" href="/contact?topic=organisation_proposal">
              talk to VerifyMzansi
            </Link>{" "}
            about a 90- or 180-day programme.
          </p>
        </div>
      ) : null}

      {pilotEnded ? (
        <section className="rounded-xl border bg-card p-4 text-sm">
          <h2 className="font-semibold">Your founding pilot has ended</h2>
          <p className="mt-1 text-muted-foreground">
            Nothing renews automatically. Confirmed affiliations stay on business profiles;
            sponsored visibility has ended. Review the performance report, then ask for a 90- or
            180-day programme proposal.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium"
              href="/advertise#programmes"
            >
              See programme prices
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-md bg-brand-green px-3 font-medium text-white"
              href="/contact?topic=organisation_proposal"
            >
              Request a custom quotation
            </Link>
          </div>
        </section>
      ) : null}

      {offer ? <ExtensionOfferCard offer={offer} canRespond={isOwner} /> : null}

      <section aria-labelledby="programme-places" className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-4">
          <h2 id="programme-places" className="text-sm font-semibold">
            Supported places
          </h2>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums">
            {filled} of {capacity} places filled
            {waiting > 0 ? (
              <span className="text-base font-normal text-muted-foreground">
                {" "}
                · {waiting} waiting
              </span>
            ) : null}
          </p>
          <div
            role="meter"
            aria-label="Supported places filled"
            aria-valuemin={0}
            aria-valuemax={capacity}
            aria-valuenow={filled}
            className="mt-3 h-2 rounded-full bg-muted"
          >
            <div
              className={
                fillPercent >= 90
                  ? "h-2 rounded-full bg-brand-gold-500"
                  : "h-2 rounded-full bg-brand-green"
              }
              style={{ width: `${fillPercent}%` }}
            />
          </div>
        </div>
        <div className="rounded-xl border p-4 text-sm">
          <h2 className="font-semibold">Programme dates</h2>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Started</dt>
            <dd>{org.trial_starts_at ? date.format(new Date(org.trial_starts_at)) : "—"}</dd>
            <dt className="text-muted-foreground">Ends</dt>
            <dd>{s.trialEndsAt ? date.format(new Date(s.trialEndsAt)) : "—"}</dd>
            <dt className="text-muted-foreground">Days left</dt>
            <dd className="tabular-nums">{s.daysRemaining ?? "—"}</dd>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing renews or charges automatically.
          </p>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Pending requests", s.pending ?? 0],
          ["More information required", s.moreInfo ?? 0],
          ["Approved", s.approved ?? 0],
          ["Declined", s.declined ?? 0],
          ["Affiliated businesses", s.affiliated ?? 0],
          ["Sponsored positions", `${s.sponsored ?? 0} / ${s.sponsoredCapacity ?? 0}`],
          [
            "Available sponsored slots",
            Math.max(0, (s.sponsoredCapacity ?? 0) - (s.sponsored ?? 0)),
          ],
          ["Waiting list", s.waitlisted ?? 0],
        ].map(([name, value]) => (
          <div key={String(name)} className="rounded-xl border p-3">
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd className="font-display text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Tabs defaultValue="applications" className="min-w-0">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <TabsList className="w-max">
            <TabsTrigger value="applications">Applications</TabsTrigger>
            <TabsTrigger value="members">Businesses</TabsTrigger>
            <TabsTrigger value="report">Performance</TabsTrigger>
            <TabsTrigger value="profile">Profile &amp; admins</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="applications" className="mt-4">
          <ApplicationsReview
            organisationId={org.id}
            applications={(applications.data ?? []) as OrganisationApplicationRow[]}
          />
        </TabsContent>
        <TabsContent value="members" className="mt-4">
          <MembersManager
            organisationId={org.id}
            members={(members.data ?? []) as OrganisationMemberRow[]}
            sponsoredCapacity={s.sponsoredCapacity ?? 0}
            canSponsor={["founding_trial", "active_paid"].includes(org.programme_status)}
            allowFoundingSponsorship={false}
          />
        </TabsContent>
        <TabsContent value="report" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium"
              href={`/api/organisations/${org.id}/report?from=${reportFrom}`}
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              Download report (CSV)
            </a>
            <a
              className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium"
              href={`/api/organisations/${org.id}/report?days=30`}
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              Last 30 days (CSV)
            </a>
          </div>
          {parsedReport ? (
            <PerformanceReport organisationName={org.name} report={parsedReport} />
          ) : null}
        </TabsContent>
        <TabsContent value="profile" className="mt-4 space-y-3 text-sm">
          <p>
            Public page:{" "}
            {org.is_public ? (
              <Link className="underline" href={`/organisation/${org.slug}`}>
                /organisation/{org.slug}
              </Link>
            ) : (
              "not yet published"
            )}
            . Badge wording: “{org.affiliation_wording}”.
          </p>
          <p className="text-muted-foreground">
            Administrators: {adminIds.length} of {s.adminLimit ?? 0}. VerifyMzansi sends new
            administrators an email invitation. To change your profile, programme description, logo
            or wording, contact VerifyMzansi; a logo is shown only once written permission is on
            record.
          </p>
          <ul className="space-y-1">
            {(admins.data ?? []).map((row) => (
              <li key={row.user_id}>
                {(adminProfiles.data ?? []).find((p) => p.user_id === row.user_id)?.display_name ??
                  "Administrator"}{" "}
                · {row.role}
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
