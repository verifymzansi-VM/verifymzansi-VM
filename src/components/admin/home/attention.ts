import { navFor } from "@/lib/admin/nav";
import type { StaffDashboard } from "@/lib/services/staff-dashboard";
import type { StaffRole } from "@/types/enums";

/**
 * What on the staff home needs a person now, most urgent first. Only sections
 * present in the viewer's dashboard count, so each role sees its own work, and
 * queue items someone has already claimed are left out.
 * Unreadable sections (null) are left out here; their cards say "Unavailable".
 */

export type AttentionItem = {
  key: string;
  /** Short plural-aware phrase, e.g. "3 reports past their deadline". */
  label: string;
  count: number;
  href: string;
  /** "urgent" is late, failing or broken; "work" is a normal queue with items in it. */
  severity: "urgent" | "work";
};

/** An item waiting longer than this is called out as old. */
const STALE_AFTER_MS = 48 * 3_600_000;

/** Server-rendered per request, so reading the clock here is deterministic for the response. */
function isOlderThan(iso: string, ms: number): boolean {
  return Date.now() - new Date(iso).getTime() > ms;
}

export function isStale(iso: string | null | undefined): boolean {
  return Boolean(iso && isOlderThan(iso, STALE_AFTER_MS));
}

/** The expiry scheduler runs every few minutes; 15 minutes of silence means it stopped. */
export function expiryJobStale(platform: NonNullable<StaffDashboard["platform"]>): boolean {
  return !platform.expiry_last_run || isOlderThan(platform.expiry_last_run, 15 * 60_000);
}

function phrase(count: number, one: string, many: string): string {
  return `${new Intl.NumberFormat("en-ZA").format(count)} ${count === 1 ? one : many}`;
}

/** The page part of a link, for matching against the role's menu. */
function pathOf(href: string): string {
  return href.split("?")[0];
}

export function attentionItems(dashboard: StaffDashboard, role: StaffRole): AttentionItem[] {
  const items: AttentionItem[] = [];
  const add = (
    key: string,
    count: number | null | undefined,
    one: string,
    many: string,
    href: string,
    severity: AttentionItem["severity"]
  ) => {
    if (typeof count === "number" && count > 0) {
      items.push({ key, count, label: phrase(count, one, many), href, severity });
    }
  };

  const { reports, kyc, content, support } = dashboard.queues;
  const { decisions, dsar, restrictions, platform, retention } = dashboard;

  // Late, failing or broken first.
  add(
    "reports-breached",
    reports?.breached,
    "report past its deadline",
    "reports past their deadline",
    "/admin/reports",
    "urgent"
  );
  add(
    "dsar-overdue",
    dsar?.overdue,
    "data request overdue",
    "data requests overdue",
    "/admin/dsar?view=overdue",
    "urgent"
  );
  add(
    "escalations-expiring",
    decisions?.expiring_24h,
    "escalation expires within 24 hours",
    "escalations expire within 24 hours",
    "/admin/governance/escalations",
    "urgent"
  );
  add(
    "emergency",
    restrictions?.emergency,
    "emergency suspension to review",
    "emergency suspensions to review",
    "/admin/governance/enforcement",
    "urgent"
  );
  add(
    "failed-executions",
    decisions?.failed_executions,
    "approved decision did not apply",
    "approved decisions did not apply",
    "/admin/operations",
    "urgent"
  );
  add(
    "incidents-critical",
    platform?.incidents_critical,
    "critical incident open",
    "critical incidents open",
    "/admin/operations",
    "urgent"
  );
  add("jobs-dead", platform?.jobs_dead, "stuck job", "stuck jobs", "/admin/operations", "urgent");
  add(
    "evidence-overdue",
    retention?.evidence_overdue,
    "evidence file past its purge date",
    "evidence files past their purge date",
    "/admin/operations",
    "urgent"
  );
  if (platform && expiryJobStale(platform)) {
    items.push({
      key: "expiry-job",
      count: 1,
      label: "Expiry job has stopped running",
      href: "/admin/operations",
      severity: "urgent",
    });
  }

  // Normal work, in the order it is usually picked up.
  add(
    "kyc",
    kyc && kyc.pending - kyc.claimed,
    "identity check to review",
    "identity checks to review",
    "/admin/verification",
    "work"
  );
  add(
    "reports",
    // The urgency indicator can overlap claimed reports. Keep the waiting total
    // exact instead of estimating that overlap from independent counts.
    reports && reports.open - reports.claimed,
    "open report",
    "open reports",
    "/admin/reports",
    "work"
  );
  add(
    "content",
    content && content.pending - content.claimed,
    "content item to review",
    "content items to review",
    "/admin/moderation",
    "work"
  );
  add(
    "support",
    support?.new,
    "new support request",
    "new support requests",
    "/admin/support",
    "work"
  );
  add(
    "escalations",
    decisions && decisions.escalated + decisions.pending_approval - decisions.expiring_24h,
    "escalation waiting",
    "escalations waiting",
    "/admin/governance/escalations",
    "work"
  );
  add(
    "appeals",
    decisions?.appeals_open,
    "appeal to decide",
    "appeals to decide",
    "/admin/governance/appeals",
    "work"
  );
  add(
    "role-changes",
    decisions?.role_changes_pending,
    "staff role change to approve",
    "staff role changes to approve",
    "/admin/governance/roles",
    "work"
  );

  // Never send someone to a page their role cannot open.
  const allowed = new Set(
    navFor(role, { kyc_evidence_desk: true }).flatMap((section) =>
      section.items.map((item) => item.href)
    )
  );
  return items.filter((item) => allowed.has(pathOf(item.href)));
}
