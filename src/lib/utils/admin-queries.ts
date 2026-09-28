import { toContentEditModerationItem } from "@/lib/content-edit-moderation";
/**
 * Admin query helpers — shared data-fetching for admin pages.
 * Uses server-side Supabase client (anon key + user session for RLS).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";
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

const TOURISM_BUSINESS_FILTER = "area.eq.PROMOTIONS_EVENTS,category.eq.tourism_hospitality";

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

// ── Dashboard Area Summary ───────────────────────────────────

/** Get pending verification steps with account display name */
export async function getPendingVerifications(limit = 50): Promise<PendingVerification[]> {
  const supabase = createAdminClient();

  const { data: steps } = await supabase
    .from("verification_steps")
    .select(
      "id, user_id, step_type, status, created_at, updated_at, risk_level, risk_score, auto_status, reviewed_at"
    )
    .eq("status", "pending")
    .neq("step_type", "location")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!steps?.length) return [];

  // Get account profiles for each user

  const userIds = Array.from(new Set(steps.map((s) => s.user_id))) as string[];
  const profileMap = await getVerificationProfileMap(
    supabase,
    userIds,
    "user_id, display_name, account_verification_status"
  );

  return steps.map((s) => {
    const profile = profileMap.get(s.user_id);
    return {
      ...s,
      account_display_name: profile?.display_name || null,
      account_verification_status: readAccountVerificationStatus(profile),
    };
  });
}

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
  const profileMap = new Map(profileRows.map((profile) => [profile.user_id, profile] as const));

  const missingProfileUserIds = userIds.filter(
    (userId) => !normalizeDisplayName(profileMap.get(userId)?.display_name)
  );

  if (missingProfileUserIds.length === 0) {
    return profileMap;
  }

  const repairedUserIds = (
    await Promise.all(
      missingProfileUserIds.map(async (userId) => {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (error || !data.user) {
          return null;
        }

        const repairedProfile = await ensureAccountProfile(supabase, data.user);
        return repairedProfile ? userId : null;
      })
    )
  ).filter((userId): userId is string => Boolean(userId));

  if (repairedUserIds.length === 0) {
    return profileMap;
  }

  const { data: repairedProfiles } = await supabase
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select(fields)
    .in("user_id", repairedUserIds);

  const repairedRows = (repairedProfiles || []) as unknown as VerificationProfileRecord[];

  for (const profile of repairedRows) {
    profileMap.set(profile.user_id, profile);
  }

  return profileMap;
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
  limit = 50
): Promise<PendingVerificationGroup[]> {
  const pendingSteps = await getPendingVerifications(limit);

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

  const { data } = await query;
  return (data as AuditLogEntry[]) || [];
}

/** Get open reports for an area with all needed fields */
export async function getAreaReports(area: MarketplaceArea) {
  const supabase = createAdminClient();

  const targetTypeMap: Record<MarketplaceArea, string[]> = {
    MZANSI_MARKET: ["listing", "account_profile"],
    MZANSI_BUSINESS: ["business", "business_profile", "storefront"],
    PROMOTIONS_EVENTS: ["promotion"],
  };

  const { data } = await supabase
    .from("reports")
    .select("*")
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(100);

  return (data || []).filter((report) => {
    const explicitArea = (report as { area?: MarketplaceArea | null }).area;
    if (explicitArea) return explicitArea === area;
    return targetTypeMap[area].includes((report as { target_type: string }).target_type);
  });
}

/** Get content pending moderation for an area */
async function getPendingNewContent(area: MarketplaceArea) {
  const supabase = createAdminClient();

  if (area === "MZANSI_MARKET") {
    const { data } = await supabase
      .from("listings")
      .select("*")
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(50);

    return (data || []).map((item) => ({
      ...item,
      title: item.title,
      itemType: "Listing",
      contentType: "listing",
      area: "MZANSI_MARKET",
      areaLabel: "Mzansi Market",
    }));
  }

  if (area === "MZANSI_BUSINESS") {
    const { data } = await supabase
      .from("businesses")
      .select("*")
      .eq("area", "MZANSI_BUSINESS")
      .neq("category", "tourism_hospitality")
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(50);

    return (data || []).map((item) => ({
      ...item,
      title: item.business_name,
      itemType: "Business",
      contentType: "business",
      area: "MZANSI_BUSINESS",
      areaLabel: "Mzansi Business",
    }));
  }

  if (area === "PROMOTIONS_EVENTS") {
    const [{ data: promotions }, { data: tourismBusinesses }] = await Promise.all([
      supabase
        .from("promotions")
        .select("*")
        .eq("status", "pending_moderation")
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("businesses")
        .select("*")
        .or(TOURISM_BUSINESS_FILTER)
        .eq("status", "pending_moderation")
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

    return [
      ...(promotions || []).map((item) => ({
        ...item,
        title: item.title,
        itemType: "Event",
        contentType: "promotion",
        area: "PROMOTIONS_EVENTS",
        areaLabel: "Tourism & Events",
      })),
      ...(tourismBusinesses || []).map((item) => ({
        ...item,
        title: item.business_name,
        itemType: "Tourism business",
        contentType: "business",
        area: "PROMOTIONS_EVENTS",
        areaLabel: "Tourism & Events",
      })),
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  return [];
}

// ── Dashboard-specific richer queries ────────────────────────

/** Live posts stay live while their proposed edits wait in a separate table. */
export async function getPendingContent(area: MarketplaceArea) {
  const [content, edits] = await Promise.all([
    getPendingNewContent(area),
    createAdminClient()
      .from("content_edit_requests")
      .select(
        "id, target_type, target_id, owner_id, area, status, proposed_data, current_snapshot, created_at"
      )
      .eq("area", area)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50),
  ]);
  if (edits.error) throw new Error("Failed to load pending post edits");
  return [...content, ...(edits.data ?? []).map(toContentEditModerationItem)].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
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
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let query = supabase
    .from("moderation_actions")
    .select("action")
    .gte("created_at", todayStart.toISOString());

  if (area) {
    query = query.eq("area", area);
  }

  const { data } = await query;
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const action = (row as { action: string }).action;
    counts[action] = (counts[action] || 0) + 1;
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
