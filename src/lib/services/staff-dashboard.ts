import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import type { NavBadge } from "@/lib/admin/nav";
import type { StaffRole } from "@/types/enums";

/**
 * The staff home and sidebar counts (20260929120000_staff_dashboard.sql).
 * One database call each. A section that is missing is not for the viewer's
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
  const { data, error } = await createAdminClient().rpc("staff_dashboard", { p_actor: actorId });
  if (error || !data) {
    log.error("Staff dashboard read failed", { error: error?.message ?? "no data" });
    return null;
  }
  return data as StaffDashboard;
});

/** Sidebar badge counts; an empty object (no badges) if they cannot be read. */
export const getStaffNavCounts = cache(async (actorId: string): Promise<StaffNavCounts> => {
  const { data, error } = await createAdminClient().rpc("staff_nav_counts", { p_actor: actorId });
  if (error || !data) {
    log.warn("Staff navigation counts unavailable", { error: error?.message ?? "no data" });
    return {};
  }
  return data as StaffNavCounts;
});
