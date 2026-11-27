import "server-only";
import { readFoundationServerSession } from "./server-session";
import { readFrontendEnforcement } from "./enforcement";
import { readFrontendPrivacyQueue } from "./privacy-requests";
import { readFrontendAppeals } from "./member-appeals";
import { readRestoredStaffRoles } from "./staff-role-review";
import { readStaffOperationsHealth } from "./operations-health";
import { readMyFrontendStaffClaims } from "./staff-claims-server";
import { readNativeAreaActivity } from "./area-activity-server";
import { FoundationStaffCommandError } from "./staff-command";
import { FoundationStaffReadError } from "./staff-read";
import type { StaffDashboard } from "../services/staff-dashboard";

/**
 * The staff home's summary cards, built from the same foundation reads the
 * pages behind them use. Every read is separate and runs in parallel; one that
 * fails leaves only its own figures out (they show as "Unavailable"), never as
 * zero. Only bounded, count-bearing reads are used (at most 50 rows each).
 */

type Staff = { role: "moderator" | "governor" | "admin"; counts: { decisions: number } };
type Summary = Pick<
  StaffDashboard,
  "shift" | "decisions" | "restrictions" | "dsar" | "platform" | "retention" | "needs_reverify"
>;

/** A read refused because the staff member's authenticator code is too old. */
function needsReverify(result: PromiseSettledResult<unknown>): boolean {
  return (
    result.status === "rejected" &&
    (result.reason instanceof FoundationStaffCommandError ||
      result.reason instanceof FoundationStaffReadError) &&
    result.reason.mfaRequired
  );
}

function value<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

export async function readStaffHomeSummary(actorId: string, current: Staff): Promise<Summary> {
  const { api, user } = await readFoundationServerSession();
  if (user.id !== actorId) throw new Error("Staff overview account changed");
  const isAdmin = current.role === "admin";
  const isModerator = current.role === "moderator";
  const idle = Promise.resolve(null);

  const [claims, today, enforcement, privacy, appeals, roles, health] = await Promise.allSettled([
    readMyFrontendStaffClaims(actorId),
    readNativeAreaActivity(undefined, 1),
    isModerator ? idle : readFrontendEnforcement(api, actorId),
    isModerator ? idle : readFrontendPrivacyQueue(api, actorId, "open", 1),
    isModerator ? idle : readFrontendAppeals(api, actorId),
    isModerator ? idle : readRestoredStaffRoles(api, actorId, 1),
    isAdmin ? readStaffOperationsHealth(api) : idle,
  ]);

  const reverify = [claims, today, enforcement, privacy, appeals, roles, health].some(
    needsReverify
  );
  const claimsRead = value(claims);
  const todayRead = value(today);
  const summary: Summary = {
    ...(reverify ? { needs_reverify: true } : {}),
    shift:
      claimsRead && todayRead
        ? {
            claims: claimsRead.items
              .filter((c) => c.mine)
              .map((c) => ({
                item_type: c.item_type,
                item_id: c.id,
                queue: c.queue,
                expires_at: c.expires_at,
              })),
            escalations_open: 0,
            actions_today: Object.values(todayRead.today).reduce((a, b) => a + b, 0),
          }
        : null,
  };
  if (isModerator) return summary;

  const appealsRead = value(appeals);
  const rolesRead = value(roles);
  summary.decisions = {
    escalated: current.counts.decisions,
    expiring_24h: 0,
    oldest_at: null,
    ...(appealsRead
      ? {
          appeals_open: appealsRead.total,
          appeals_oldest_at:
            appealsRead.total === appealsRead.items.length && appealsRead.items.length > 0
              ? appealsRead.items.map((a) => a.created_at).sort()[0]
              : null,
        }
      : {}),
    ...(rolesRead ? { role_changes_pending: rolesRead.pending.length } : {}),
  };
  const enforcementRead = value(enforcement);
  summary.restrictions = enforcementRead && {
    suspensions: enforcementRead.suspensions,
    bans: enforcementRead.bans,
    emergency: enforcementRead.emergency,
  };
  const privacyRead = value(privacy);
  summary.dsar = privacyRead && {
    open: privacyRead.total,
    overdue: privacyRead.overdue,
    due_7d: privacyRead.due_soon,
    next_due_at: null,
    ...(privacyRead.total <= privacyRead.items.length
      ? { unassigned: privacyRead.items.filter((r) => !r.assigned_to).length }
      : {}),
  };
  if (!isAdmin) return summary;

  const healthRead = value(health);
  summary.platform =
    healthRead && rolesRead && rolesRead.staff_total === rolesRead.staff.length
      ? {
          incidents_open: healthRead.incidents.open,
          incidents_critical: healthRead.incidents.items.filter((i) => i.level === "critical")
            .length,
          jobs_dead: healthRead.jobs.filter((j) => j.late).length,
          jobs_waiting: healthRead.emails.waiting,
          expiry_last_run:
            healthRead.jobs.find((j) => j.job === "post_lifecycle")?.last_run_at ?? null,
          staff: {
            moderator: rolesRead.staff.filter((s) => s.role === "moderator").length,
            governance_controller: rolesRead.staff.filter((s) => s.role === "governor").length,
            admin: rolesRead.staff.filter((s) => s.role === "admin").length,
          },
        }
      : null;
  summary.retention = healthRead && {
    evidence_overdue: healthRead.deletions.evidence_overdue,
    deletions_stuck: healthRead.deletions.accounts_blocked + healthRead.deletions.files_stuck,
    legal_holds: healthRead.deletions.legal_holds,
  };
  return summary;
}
