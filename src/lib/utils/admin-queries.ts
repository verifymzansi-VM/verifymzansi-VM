import { toContentEditModerationItem } from "@/lib/content-edit-moderation";
import {
  BUSINESS_FIELDS,
  EDIT_FIELDS,
  LISTING_FIELDS,
  MZANSI_BUSINESS_FILTER,
  PROMOTION_FIELDS,
  TOURISM_BUSINESS_FILTER,
  businessItem,
  listingItem,
  oldestFirst,
  promotionItem,
} from "@/lib/admin/moderation-items";
/**
 * Admin query helpers — shared data-fetching for admin pages.
 * Uses server-side Supabase client (anon key + user session for RLS).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import type { MarketplaceArea } from "@/types/enums";

// ── Types ────────────────────────────────────────────────────

export interface PendingVerification {
  id: string;
  user_id: string;
  step_type: string;
  status: string;
  created_at: string;
  updated_at?: string | null;
  risk_level: string | null;
  risk_score: number | null;
  auto_status: string | null;
  reviewed_at: string | null;
  account_display_name?: string | null;
  account_verification_status?: string | null;
  /** @deprecated Use account_display_name */
  /** @deprecated Use account_verification_status */
}

export interface PendingVerificationGroup {
  user_id: string;
  account_display_name: string;
  account_verification_status?: string | null;
  latest_created_at: string;
  pending_step_count: number;
  primary_step_id: string;
  primary_step_type: string;
  steps: PendingVerification[];
}

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  area: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  reason?: string | null;
  previous_value?: unknown;
  new_value?: unknown;
}

export interface RecentOtpAttempt {
  id: string;
  phone: string;
  delivery_status: "pending" | "sent" | "failed";
  provider_name: string | null;
  provider_message_id: string | null;
  provider_error: string | null;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
  expires_at: string;
}

export async function getRecentOtpAttempts(limit = 12): Promise<RecentOtpAttempt[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("otp_logs")
    .select(
      "id, phone, delivery_status, provider_name, provider_message_id, provider_error, verified, verified_at, created_at, expires_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) {
    return [];
  }

  const attempts = data as RecentOtpAttempt[];
  const phones = Array.from(new Set(attempts.map((attempt) => attempt.phone).filter(Boolean)));

  if (phones.length === 0) {
    return attempts;
  }

  const { data: profiles } = await supabase
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select("user_id, phone")
    .in("phone", phones);

  const phoneToUserId = new Map<string, string>();
  for (const profile of profiles ?? []) {
    if (typeof profile.phone === "string" && profile.phone && typeof profile.user_id === "string") {
      phoneToUserId.set(profile.phone, profile.user_id);
    }
  }

  const userIds = Array.from(new Set(Array.from(phoneToUserId.values())));
  const verifiedAtByUserId = new Map<string, string>();

  if (userIds.length > 0) {
    const { data: phoneSteps } = await supabase
      .from("verification_steps")
      .select("user_id, phone_verified_at, status")
      .eq("step_type", "phone")
      .eq("status", "approved")
      .in("user_id", userIds);

    for (const step of phoneSteps ?? []) {
      if (typeof step.user_id === "string" && typeof step.phone_verified_at === "string") {
        verifiedAtByUserId.set(step.user_id, step.phone_verified_at);
      }
    }
  }

  return attempts.map((attempt) => {
    const fallbackVerifiedAt =
      verifiedAtByUserId.get(phoneToUserId.get(attempt.phone) ?? "") ?? null;
    const verifiedAt = attempt.verified_at ?? fallbackVerifiedAt;

    return {
      ...attempt,
      verified: attempt.verified || Boolean(verifiedAt),
      verified_at: verifiedAt,
    };
  });
}

// ── Queries ──────────────────────────────────────────────────

const PENDING_STEP_FIELDS =
  "id, user_id, step_type, status, created_at, updated_at, risk_level, risk_score, auto_status, reviewed_at";

/**
 * Pending identity checks (the KYC queue: everything except location), oldest
 * first, with the member's display name. `includeIds` adds specific steps
 * that may lie beyond `limit`, such as the ones the viewer has claimed.
 * Throws when the queue cannot be read, so callers never show a failed read
 * as an empty queue.
 */
export async function getPendingVerifications(
  limit = 50,
  options: { includeIds?: string[] } = {}
): Promise<PendingVerification[]> {
  const supabase = createAdminClient();
  const includeIds = options.includeIds ?? [];

  const [oldest, included] = await Promise.all([
    supabase
      .from("verification_steps")
      .select(PENDING_STEP_FIELDS)
      .eq("status", "pending")
      .neq("step_type", "location")
      .order("created_at", { ascending: true })
      .limit(limit),
    includeIds.length
      ? supabase
          .from("verification_steps")
          .select(PENDING_STEP_FIELDS)
          .eq("status", "pending")
          .in("id", includeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (oldest.error || included.error) {
    throw new Error(
      `Pending verifications could not be read: ${(oldest.error ?? included.error)?.message}`
    );
  }

  const byId = new Map<string, PendingVerificationRow>();
  for (const step of [
    ...(included.data ?? []),
    ...(oldest.data ?? []),
  ] as PendingVerificationRow[]) {
    byId.set(step.id, step);
  }
  const steps = [...byId.values()];
  if (!steps.length) return [];

  const userIds = Array.from(new Set(steps.map((s) => s.user_id)));
  const profileMap = await getVerificationProfileMap(
    supabase,
    userIds,
    "user_id, display_name, account_verification_status"
  );

  return steps.map((s) => {
    const profile = profileMap.get(s.user_id);
    return {
      ...s,
      account_display_name: normalizeDisplayName(profile?.display_name),
      account_verification_status: readAccountVerificationStatus(profile),
    };
  });
}

/** How many identity checks are waiting in total, whatever is shown. */
export async function countPendingVerifications(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("verification_steps")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .neq("step_type", "location");
  if (error) throw new Error(`Pending verifications could not be counted: ${error.message}`);
  return count ?? 0;
}

type PendingVerificationRow = Omit<
  PendingVerification,
  "account_display_name" | "account_verification_status"
>;

type VerificationProfileRecord = {
  user_id: string;
  display_name: string | null;
  account_verification_status?: string | null;
  account_status?: string | null;
  strikes?: number | null;
};

function normalizeDisplayName(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Account profiles for the given members, in one read. Profiles are created
 * at sign-in, OTP verification and upload, so a member with a pending step
 * has one; a missing name shows as "New Member" rather than triggering a
 * write from a staff page.
 */
async function getVerificationProfileMap(
  supabase: ReturnType<typeof createAdminClient>,
  userIds: string[],
  fields = "user_id, display_name, account_verification_status"
): Promise<Map<string, VerificationProfileRecord>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const { data: profiles } = await supabase
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select(fields)
    .in("user_id", userIds);

  const profileRows = (profiles || []) as unknown as VerificationProfileRecord[];
  return new Map(profileRows.map((profile) => [profile.user_id, profile] as const));
}

const VERIFICATION_STEP_DISPLAY_ORDER: Record<string, number> = {
  id_doc: 0,
  selfie: 1,
  phone: 2,
};

function sortPendingVerificationSteps(a: PendingVerification, b: PendingVerification): number {
  const orderA = VERIFICATION_STEP_DISPLAY_ORDER[a.step_type] ?? Number.MAX_SAFE_INTEGER;
  const orderB = VERIFICATION_STEP_DISPLAY_ORDER[b.step_type] ?? Number.MAX_SAFE_INTEGER;

  if (orderA !== orderB) {
    return orderA - orderB;
  }

  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

export async function getPendingVerificationGroups(
  limit = 50,
  options: { includeIds?: string[] } = {}
): Promise<PendingVerificationGroup[]> {
  const pendingSteps = await getPendingVerifications(limit, options);

  if (pendingSteps.length === 0) {
    return [];
  }

  const groups = new Map<string, PendingVerificationGroup>();

  for (const step of pendingSteps) {
    const existing = groups.get(step.user_id);
    if (!existing) {
      groups.set(step.user_id, {
        user_id: step.user_id,
        account_display_name: step.account_display_name || "New Member",
        account_verification_status: step.account_verification_status || null,
        latest_created_at: step.created_at,
        pending_step_count: 1,
        primary_step_id: step.id,
        primary_step_type: step.step_type,
        steps: [step],
      });
      continue;
    }

    existing.steps.push(step);
    existing.pending_step_count += 1;

    const stepCreatedAt = new Date(step.created_at).getTime();
    const latestCreatedAt = new Date(existing.latest_created_at).getTime();
    if (stepCreatedAt >= latestCreatedAt) {
      existing.latest_created_at = step.created_at;
    }
  }

  return Array.from(groups.values())
    .map((group) => {
      const sortedSteps = [...group.steps].sort(sortPendingVerificationSteps);
      const primaryStep = sortedSteps[0] ?? group.steps[0];
      return {
        ...group,
        account_display_name:
          sortedSteps.find((step) => normalizeDisplayName(step.account_display_name))
            ?.account_display_name || group.account_display_name,
        account_verification_status:
          sortedSteps.find((step) => step.account_verification_status)
            ?.account_verification_status || group.account_verification_status,
        primary_step_id: primaryStep.id,
        primary_step_type: primaryStep.step_type,
        steps: sortedSteps,
      };
    })
    .sort(
      (a, b) => new Date(b.latest_created_at).getTime() - new Date(a.latest_created_at).getTime()
    );
}

/** Get recent audit log entries */
export async function getRecentActivity(limit = 20, area?: string): Promise<AuditLogEntry[]> {
  const supabase = createAdminClient();

  let query = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (area) {
    query = query.eq("area", area);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Recent activity could not be read: ${error.message}`);
  return (data as AuditLogEntry[]) || [];
}

/**
 * Open and in-progress reports for an area, oldest first. Filtered in the
 * database (`reports.area` is required), so a busy area never hides another
 * area's reports behind a shared limit. Throws when the read fails.
 */
export async function getAreaReports(area: MarketplaceArea) {
  const { data, error } = await createAdminClient()
    .from("reports")
    .select("*")
    .eq("area", area)
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Area reports could not be read: ${error.message}`);
  return data ?? [];
}

/** Get content pending moderation for an area */
/** A failed read throws, so the page says so instead of showing an empty queue. */
function rowsOrThrow<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  if (result.error) throw new Error(`Failed to load pending content: ${result.error.message}`);
  return result.data ?? [];
}

async function getPendingNewContent(area: MarketplaceArea) {
  const supabase = createAdminClient();
  const pending = <T extends string>(table: "listings" | "businesses" | "promotions", fields: T) =>
    supabase
      .from(table)
      .select(fields)
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(50);

  if (area === "MZANSI_MARKET") {
    return rowsOrThrow(await pending("listings", LISTING_FIELDS)).map(listingItem);
  }

  if (area === "MZANSI_BUSINESS") {
    const businesses = rowsOrThrow(
      await pending("businesses", BUSINESS_FIELDS)
        .eq("area", "MZANSI_BUSINESS")
        .or(MZANSI_BUSINESS_FILTER)
    );
    return businesses.map(businessItem);
  }

  if (area === "PROMOTIONS_EVENTS") {
    const [promotions, tourismBusinesses] = await Promise.all([
      pending("promotions", PROMOTION_FIELDS),
      pending("businesses", BUSINESS_FIELDS).or(TOURISM_BUSINESS_FILTER),
    ]);
    return oldestFirst([
      ...rowsOrThrow(promotions).map(promotionItem),
      ...rowsOrThrow(tourismBusinesses).map(businessItem),
    ]);
  }

  return [];
}

export async function getPendingContent(area: MarketplaceArea) {
  const [content, edits] = await Promise.all([
    getPendingNewContent(area),
    createAdminClient()
      .from("content_edit_requests")
      .select(EDIT_FIELDS)
      .eq("area", area)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
  ]);
  if (edits.error) throw new Error("Failed to load pending post edits");
  return oldestFirst([...content, ...(edits.data ?? []).map(toContentEditModerationItem)]);
}

export interface DashboardReport {
  id: string;
  target_id: string;
  target_type: string;
  area: string;
  category: string;
  severity: "high" | "standard";
  status: string;
  description: string | null;
  reporter_user_id: string | null;
  created_at: string;
}

// ── Verification funnel & extended platform stats ─────────────

/** Count moderation actions taken today, grouped by action type */
export async function getActionsToday(area?: string): Promise<Record<string, number>> {
  const supabase = createAdminClient();
  // Midnight in South Africa (UTC+2, no daylight saving), whatever the server's clock zone.
  const saDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(
    new Date()
  );
  const todayStart = new Date(`${saDate}T00:00:00+02:00`);

  const counts: Record<string, number> = {};
  const snapshotEnd = new Date().toISOString();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    // PostgREST caps returned rows. Page through the same time window so busy
    // days are counted fully and new actions cannot keep extending the scan.
    let query = supabase
      .from("moderation_actions")
      .select("action")
      .gte("created_at", todayStart.toISOString())
      .lte("created_at", snapshotEnd)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (area) query = query.eq("area", area);
    const { data, error } = await query;
    if (error) throw new Error(`Today's actions could not be counted: ${error.message}`);
    for (const row of data ?? []) {
      const action = row.action;
      counts[action] = (counts[action] || 0) + 1;
    }
    if (!data || data.length < pageSize) break;
  }
  return counts;
}

// ── Site visit analytics (admin home) ─────────────────────────

export interface SiteVisitDailyPoint {
  date: string; // YYYY-MM-DD
  visits: number;
  visitors: number;
}

export interface SiteVisitTopPage {
  path: string;
  visits: number;
}

export interface SiteVisitStats {
  available: boolean;
  visitsToday: number;
  visits7d: number;
  visits30d: number;
  uniqueVisitorsToday: number;
  uniqueVisitors7d: number;
  uniqueVisitors30d: number;
  daily: SiteVisitDailyPoint[]; // last 14 days, oldest first
  topPages: SiteVisitTopPage[];
  byArea: { area: string; visits: number }[];
}

export const EMPTY_SITE_VISIT_STATS: SiteVisitStats = {
  available: false,
  visitsToday: 0,
  visits7d: 0,
  visits30d: 0,
  uniqueVisitorsToday: 0,
  uniqueVisitors7d: 0,
  uniqueVisitors30d: 0,
  daily: [],
  topPages: [],
  byArea: [],
};

/** One database snapshot; aggregate results are not subject to REST row limits. */
export async function getSiteVisitStats(): Promise<SiteVisitStats> {
  try {
    const { data, error } = await createAdminClient().rpc("get_site_visit_stats");
    if (error || !data) return EMPTY_SITE_VISIT_STATS;
    return { ...(data as Omit<SiteVisitStats, "available">), available: true };
  } catch {
    return EMPTY_SITE_VISIT_STATS;
  }
}
