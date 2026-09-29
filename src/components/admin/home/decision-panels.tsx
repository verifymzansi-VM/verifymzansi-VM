import { formatRelativeTime, formatSaShortDate } from "@/lib/utils/format";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";
import { formatCount, MetricList, oldestLabel, SectionHeading, StatCard } from "./home-cards";

/** "1 appeal", "3 appeals". */
function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** Decisions waiting on a governor or admin, and the data-request deadlines. */
export function DecisionsPanel({
  decisions,
  restrictions,
  dsar,
}: Pick<StaffDashboard, "decisions" | "restrictions" | "dsar">) {
  return (
    <section className="space-y-3" aria-labelledby="home-decisions">
      <div id="home-decisions">
        <SectionHeading
          title="Waiting for a decision"
          description="Each list opens oldest first. Nothing is final until someone independent acts."
        />
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
        <StatCard
          label="Escalations"
          value={decisions && decisions.escalated + decisions.pending_approval}
          href="/admin/governance/escalations"
          detail={
            decisions && (
              <>
                {formatCount(decisions.pending_approval)} need a second approval
                {decisions.expiring_24h > 0 && (
                  <p className="font-medium text-destructive">
                    {plural(decisions.expiring_24h, "expires", "expire")} within 24 hours
                  </p>
                )}
                {oldestLabel(decisions.oldest_at) && <p>{oldestLabel(decisions.oldest_at)}</p>}
              </>
            )
          }
        />
        <StatCard
          label="Appeals"
          value={decisions?.appeals_open}
          href="/admin/governance/appeals"
          detail={decisions && oldestLabel(decisions.appeals_oldest_at)}
        />
        <StatCard
          label="Data requests overdue"
          value={dsar?.overdue}
          href="/admin/dsar?view=overdue"
          urgent
          detail={
            dsar && (
              <>
                {formatCount(dsar.open)} open · {formatCount(dsar.due_7d)} due within 7 days
                {dsar.unassigned > 0 && ` · ${formatCount(dsar.unassigned)} unassigned`}
                {dsar.next_due_at && <p>Next deadline {formatSaShortDate(dsar.next_due_at)}</p>}
              </>
            )
          }
        />
        <StatCard
          label="Active restrictions"
          value={restrictions && restrictions.suspensions + restrictions.bans}
          href="/admin/governance/enforcement"
          detail={
            restrictions && (
              <>
                {formatCount(restrictions.suspensions)} suspended · {formatCount(restrictions.bans)}{" "}
                banned
                {restrictions.emergency > 0 && (
                  <p className="font-medium text-destructive">
                    {plural(
                      restrictions.emergency,
                      "emergency suspension needs",
                      "emergency suspensions need"
                    )}{" "}
                    review
                  </p>
                )}
              </>
            )
          }
        />
        <StatCard
          label="Decisions not applied"
          value={decisions?.failed_executions}
          href="/admin/operations"
          urgent
          detail="Approved, but the change did not finish. Retry it from Operations health."
        />
        <StatCard
          label="Staff role changes"
          value={decisions?.role_changes_pending}
          href="/admin/governance/roles"
          detail="Waiting for a second person to approve"
        />
      </div>
    </section>
  );
}

/** Team-level quality signals over 30 days. Counts, not rankings. */
export function OversightPanel({ oversight }: Pick<StaffDashboard, "oversight">) {
  return (
    <MetricList
      id="home-oversight"
      title="Last 30 days"
      description="How often decisions were escalated or overturned."
      rows={[
        {
          label: "Appeals overturned",
          value: oversight?.appeals_overturned,
          href: "/admin/governance/oversight",
          detail:
            oversight &&
            (oversight.appeals_resolved > 0
              ? `of ${plural(oversight.appeals_resolved, "appeal", "appeals")} decided (${Math.round((oversight.appeals_overturned / oversight.appeals_resolved) * 100)}%)`
              : "No appeals decided yet"),
        },
        {
          label: "Decisions escalated",
          value: oversight?.escalations,
          href: "/admin/governance/oversight",
          detail:
            oversight &&
            (oversight.decisions_made > 0
              ? `of ${plural(oversight.decisions_made, "decision", "decisions")} made`
              : "No decisions made yet"),
        },
      ]}
    />
  );
}

/** Operations health for admins: incidents, stuck jobs, schedulers and retention. */
export function PlatformPanel({
  platform,
  retention,
  breachedReports,
}: Pick<StaffDashboard, "platform" | "retention"> & { breachedReports: number | undefined }) {
  const expiryStale =
    platform && (!platform.expiry_last_run || isOlderThan(platform.expiry_last_run, 15 * 60_000));
  return (
    <MetricList
      id="home-platform"
      title="Platform health"
      description="Anything above zero needs a person."
      rows={[
        {
          label: "Reports past deadline",
          value: breachedReports,
          href: "/admin/reports",
          urgent: true,
        },
        {
          label: "Open incidents",
          value: platform?.incidents_open,
          href: "/admin/operations",
          alarming: Boolean(platform && platform.incidents_critical > 0),
          detail: platform && `${formatCount(platform.incidents_critical)} critical`,
        },
        {
          label: "Stuck jobs",
          value: platform?.jobs_dead,
          href: "/admin/operations",
          urgent: true,
          detail: platform && `${formatCount(platform.jobs_waiting)} waiting to run`,
        },
        {
          label: "Evidence past purge date",
          value: retention?.evidence_overdue,
          href: "/admin/operations",
          urgent: true,
          detail: retention && `${formatCount(retention.deletions_stuck)} deletions stuck`,
        },
        {
          label: "Expiry job",
          value: platform ? (expiryStale ? "Not running" : "Running") : undefined,
          href: "/admin/operations",
          alarming: Boolean(expiryStale),
          detail:
            platform &&
            (platform.expiry_last_run
              ? `Last run ${formatRelativeTime(platform.expiry_last_run)}`
              : "No run recorded"),
        },
      ]}
    />
  );
}

/** Server-rendered per request, so reading the clock here is deterministic for the response. */
function isOlderThan(iso: string, ms: number): boolean {
  return Date.now() - new Date(iso).getTime() > ms;
}

export function TeamPanel({
  platform,
  roleChanges,
}: {
  platform: StaffDashboard["platform"];
  roleChanges: number | undefined;
}) {
  return (
    <MetricList
      id="home-team"
      title="Team"
      rows={[
        { label: "Moderators", value: platform?.staff.moderator, href: "/admin/governance/roles" },
        {
          label: "Governors",
          value: platform?.staff.governance_controller,
          href: "/admin/governance/roles",
        },
        {
          label: "Admins",
          value: platform?.staff.admin,
          href: "/admin/governance/roles",
          detail:
            platform && platform.staff.admin < 2
              ? "Keep at least two admins for recovery"
              : undefined,
        },
        { label: "Role changes waiting", value: roleChanges, href: "/admin/governance/roles" },
      ]}
    />
  );
}
