import Link from "next/link";
import { Ban, CheckCircle2, FileText, Gavel, RotateCcw, Scale, UserCog } from "lucide-react";
import { formatRelativeTime, formatSaShortDate } from "@/lib/utils/format";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";
import { expiryJobStale } from "./attention";
import { formatCount, MetricList, OldestLine, SectionHeading, StatCard } from "./home-cards";

/** "1 appeal", "3 appeals". */
function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

/** Lists with nothing in them, as one quiet row of links instead of a card each. */
function ClearLists({ lists }: { lists: { label: string; href: string }[] }) {
  if (lists.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-card/60 px-3 py-2.5 sm:px-4">
      <span className="mr-1 inline-flex items-center gap-1.5 text-sm font-medium text-brand-green-700 dark:text-brand-green-300">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Clear
      </span>
      <ul className="flex flex-wrap gap-1.5" aria-label="Lists with nothing waiting">
        {lists.map((list) => (
          <li key={list.href}>
            <Link
              href={list.href}
              className="inline-flex min-h-9 items-center rounded-full border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {list.label}
              <span className="ml-1.5 tabular-nums text-muted-foreground/60">0</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

type DecisionCard = {
  label: string;
  href: string;
  /** Zero moves the list into the "Clear" row; null (unreadable) keeps its card. */
  value: number | null | undefined;
  card: React.ReactNode;
};

/** Decisions waiting on a governor or admin, and the data-request deadlines. */
export function DecisionsPanel({
  decisions,
  restrictions,
  dsar,
}: Pick<StaffDashboard, "decisions" | "restrictions" | "dsar">) {
  const cards: DecisionCard[] = [
    {
      label: "Escalations",
      href: "/admin/governance/escalations",
      value: decisions && decisions.escalated + decisions.pending_approval,
      card: (
        <StatCard
          label="Escalations"
          icon={Gavel}
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
                <OldestLine at={decisions.oldest_at} />
              </>
            )
          }
        />
      ),
    },
    {
      label: "Appeals",
      href: "/admin/governance/appeals",
      value: decisions?.appeals_open,
      card: (
        <StatCard
          label="Appeals"
          icon={Scale}
          value={decisions?.appeals_open}
          href="/admin/governance/appeals"
          detail={decisions && <OldestLine at={decisions.appeals_oldest_at} />}
        />
      ),
    },
    {
      label: "Data requests",
      href: "/admin/dsar?view=overdue",
      // Open requests keep the card, so their deadlines stay in view.
      value: dsar && dsar.overdue + dsar.open,
      card: (
        <StatCard
          label="Data requests overdue"
          icon={FileText}
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
      ),
    },
    {
      label: "Restrictions",
      href: "/admin/governance/enforcement",
      value: restrictions && restrictions.suspensions + restrictions.bans,
      card: (
        <StatCard
          label="Active restrictions"
          icon={Ban}
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
      ),
    },
    {
      label: "Decisions not applied",
      href: "/admin/operations",
      value: decisions?.failed_executions,
      card: (
        <StatCard
          label="Decisions not applied"
          icon={RotateCcw}
          value={decisions?.failed_executions}
          href="/admin/operations"
          urgent
          detail="Approved, but the change did not finish. Retry it from Operations health."
        />
      ),
    },
    {
      label: "Staff role changes",
      href: "/admin/governance/roles",
      value: decisions?.role_changes_pending,
      card: (
        <StatCard
          label="Staff role changes"
          icon={UserCog}
          value={decisions?.role_changes_pending}
          href="/admin/governance/roles"
          detail="Waiting for a second person to approve"
        />
      ),
    },
  ];
  const open = cards.filter((c) => c.value !== 0);
  const clear = cards.filter((c) => c.value === 0);

  return (
    <section className="space-y-3" aria-labelledby="home-decisions">
      <div id="home-decisions">
        <SectionHeading
          title="Waiting for a decision"
          description={
            open.length === 0
              ? "Nothing is waiting. New items appear here oldest first."
              : "Each list opens oldest first. Nothing is final until someone independent acts."
          }
        />
      </div>
      {open.length > 0 && (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-3">
          {open.map((c) => (
            <div key={c.href} className="contents">
              {c.card}
            </div>
          ))}
        </div>
      )}
      <ClearLists lists={clear.map(({ label, href }) => ({ label, href }))} />
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
  const expiryStale = platform && expiryJobStale(platform);
  return (
    <MetricList
      id="home-platform"
      title="Platform health"
      description="Anything above zero needs a person."
      summarise
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
