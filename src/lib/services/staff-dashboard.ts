import { cache } from "react";
import { createLogger } from "@/lib/utils/logger";
import type { NavBadge } from "@/lib/admin/nav";
import type { StaffRole } from "@/types/enums";
import { readFoundationStaffDashboard } from "@/lib/foundation/staff-dashboard";

/**
 * The staff home and sidebar counts, read from the foundation staff
 * dashboard. A section that is missing is not for the viewer's
 * role; a section that is null could not be read and must show as
 * "Unavailable", never as zero.
 */

const log = createLogger("StaffDashboard");

type Count = number;
type Timestamp = string | null;

export interface StaffDashboard {
  role: StaffRole;
  generated_at: string;
  queues: {
    reports: { open: Count; oldest_at: Timestamp; breached: Count; claimed: Count } | null;
    kyc: { pending: Count; oldest_at: Timestamp; high_risk: Count; claimed: Count } | null;
    content: { pending: Count; oldest_at: Timestamp; claimed: Count } | null;
    support: { new: Count; oldest_at: Timestamp } | null;
    /** Business verification cases waiting on staff. */
    business_kyc?: {
      pending: Count;
      oldest_at: Timestamp;
      breached: Count;
      claimed: Count;
    } | null;
  };
  shift?: {
    claims: Array<{
      item_type: string;
      item_id: string;
      queue: "reports" | "kyc" | "content" | "business_kyc";
      expires_at: string;
      renewals: number;
    }>;
    escalations_open: Count;
    actions_today: Count;
  } | null;
  decisions?: {
    escalated: Count;
    pending_approval: Count;
    expiring_24h: Count;
    oldest_at: Timestamp;
    failed_executions: Count;
    role_changes_pending: Count;
    appeals_open: Count;
    appeals_oldest_at: Timestamp;
  } | null;
  restrictions?: { suspensions: Count; bans: Count; emergency: Count } | null;
  dsar?: {
    open: Count;
    overdue: Count;
    due_7d: Count;
    unassigned: Count;
    next_due_at: Timestamp;
  } | null;
  oversight?: {
    window_days: number;
    appeals_resolved: Count;
    appeals_overturned: Count;
    decisions_made: Count;
    escalations: Count;
  } | null;
  platform?: {
    incidents_open: Count;
    incidents_critical: Count;
    jobs_dead: Count;
    jobs_waiting: Count;
    expiry_last_run: Timestamp;
    staff: Record<StaffRole, Count>;
  } | null;
  retention?: { evidence_overdue: Count; deletions_stuck: Count; legal_holds: Count } | null;
}

export type StaffNavCounts = Partial<Record<NavBadge, number>>;

/** The viewer's role home, or null if it could not be read at all. Deduplicated per request. */
export const getStaffDashboard = cache(async (actorId: string): Promise<StaffDashboard | null> => {
  try {
    const current = await readFoundationStaffDashboard(actorId);
    if (!current.restored_queues) throw new Error("Staff presentation contract unavailable");
    return {
      role: current.role === "governor" ? "governance_controller" : current.role,
      generated_at: current.generated_at,
      queues: { ...current.restored_queues, support: current.support ?? null },
      // These summaries have no foundation equivalent yet.
      // The preserved cards already render null as Unavailable.
      shift: null,
      ...(current.role === "moderator" ? {} : { decisions: null }),
      ...(current.role === "admin" ? { platform: null } : {}),
    };
  } catch {
    log.error("Staff dashboard read failed");
    return null;
  }
});

/** Sidebar badge counts; an empty object (no badges) if they cannot be read. */
export const getStaffNavCounts = cache(async (actorId: string): Promise<StaffNavCounts> => {
  try {
    const current = await readFoundationStaffDashboard(actorId);
    return {
      reports: current.counts.reports,
      kyc: current.counts.kyc,
      content: current.counts.content,
      business_kyc: current.counts.business_kyc,
      ...(current.support ? { support: current.support.new } : {}),
      ...(current.role === "moderator" ? {} : { decisions: current.counts.decisions }),
    };
  } catch {
    log.warn("Staff navigation counts unavailable");
    return {};
  }
});
