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
    /** Business verification cases waiting on staff (read here, not in the RPC). */
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
  const { data, error } = await createAdminClient().rpc("staff_dashboard", { p_actor: actorId });
  if (error || !data) {
    log.error("Staff dashboard read failed", { error: error?.message ?? "no data" });
    return null;
  }
  const dashboard = data as StaffDashboard;
  dashboard.queues = { ...dashboard.queues, business_kyc: await businessKycQueue() };
  return dashboard;
});

/** 24-hour target for business verification cases (spec §3.5). */
const BUSINESS_KYC_SLA_MS = 24 * 3_600_000;

async function businessKycQueue(): Promise<StaffDashboard["queues"]["business_kyc"]> {
  const admin = createAdminClient();
  const now = new Date();
  const breachedBefore = new Date(now.getTime() - BUSINESS_KYC_SLA_MS).toISOString();
  const pending = () =>
    admin
      .from("business_verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
  const [all, breached, oldest, claimed] = await Promise.all([
    pending(),
    pending().lt("created_at", breachedBefore),
    admin
      .from("business_verifications")
      .select("created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("queue_claims")
      .select("item_id", { count: "exact", head: true })
      .eq("queue", "business_kyc")
      .gt("expires_at", now.toISOString()),
  ]);
  const failed = [all, breached, oldest, claimed].find((r) => r.error);
  if (failed?.error) {
    log.warn("Business verification queue unavailable", { error: failed.error.message });
    return null;
  }
  return {
    pending: all.count ?? 0,
    oldest_at: (oldest.data?.created_at as string | undefined) ?? null,
    breached: breached.count ?? 0,
    claimed: claimed.count ?? 0,
  };
}

/** Sidebar badge counts; an empty object (no badges) if they cannot be read. */
export const getStaffNavCounts = cache(async (actorId: string): Promise<StaffNavCounts> => {
  const { data, error } = await createAdminClient().rpc("staff_nav_counts", { p_actor: actorId });
  if (error || !data) {
    log.warn("Staff navigation counts unavailable", { error: error?.message ?? "no data" });
    return {};
  }
  return data as StaffNavCounts;
});
