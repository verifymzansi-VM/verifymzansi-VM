/**
 * Admin query helpers — shared data-fetching for admin pages.
 * Uses server-side Supabase client (anon key + user session for RLS).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";
import type { MarketplaceArea } from "@/types/enums";

// ── Types ────────────────────────────────────────────────────

export interface AdminDashboardStats {
  totalAccounts: number;
  totalMembers: number;
  totalListings: number;
  openReports: number;
  pendingVerifications: number;
  activeSuspensions: number;
  pendingModeration: number;
}

export interface PendingVerification {
  id: string;
  user_id: string;
  step_type: string;
  status: string;
  created_at: string;
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

async function getPendingModerationCountInternal() {
  const supabase = createAdminClient();

  const [{ count: pendingListings }, { count: pendingBusinesses }, { count: pendingPromotions }] =
    await Promise.all([
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_moderation"),
      supabase
        .from("businesses")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_moderation"),
      supabase
        .from("promotions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_moderation"),
    ]);

  return (pendingListings || 0) + (pendingBusinesses || 0) + (pendingPromotions || 0);
}

export async function getPendingModerationCount(): Promise<number> {
  return getPendingModerationCountInternal();
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

/** Fetch all high-level stats for the admin dashboard */
export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const supabase = createAdminClient();

  const [
    { count: totalMembers },
    { count: totalListings },
    { count: openReports },
    { count: pendingVerifications },
    { count: activeSuspensions },
    pendingModeration,
  ] = await Promise.all([
    supabase.from(ACCOUNT_PROFILE_WRITE_TABLE).select("*", { count: "exact", head: true }),
    supabase.from("listings").select("*", { count: "exact", head: true }),
    supabase.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .neq("step_type", "location"),
    supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("*", { count: "exact", head: true })
      .eq("account_status", "suspended"),
    getPendingModerationCountInternal(),
  ]);

  return {
    totalAccounts: totalMembers || 0,
    totalMembers: totalMembers || 0,
    totalListings: totalListings || 0,
    openReports: openReports || 0,
    pendingVerifications: pendingVerifications || 0,
    activeSuspensions: activeSuspensions || 0,
    pendingModeration,
  };
}

/** Get area-specific counts for the area cards on admin home */
export async function getAreaCardCounts(): Promise<
  Record<MarketplaceArea, { pendingFlags: number; pendingContent: number }>
> {
  const supabase = createAdminClient();

  // Reports counts by area — map target_type to area
  const { data: openReports } = await supabase
    .from("reports")
    .select("target_type")
    .eq("status", "open")
    .limit(10000);

  // Content pending moderation counts
  const [{ count: pendingListings }, { count: pendingMzansiBiz }, { count: pendingPromos }] =
    await Promise.all([
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_moderation"),
      supabase
        .from("businesses")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_moderation"),
      supabase
        .from("promotions")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending_moderation"),
    ]);

  // Map target_type to area
  const flagCounts = {
    MZANSI_MARKET: 0,
    BUSINESS_ADS: 0,
    MALL_SHOPS: 0,
    MZANSI_BUSINESS: 0,
    PROMOTIONS_EVENTS: 0,
  };
  for (const r of openReports || []) {
    if (r.target_type === "listing" || r.target_type === "account_profile")
      flagCounts.MZANSI_MARKET++;
    if (
      r.target_type === "business_profile" ||
      r.target_type === "storefront" ||
      r.target_type === "business"
    )
      flagCounts.MZANSI_BUSINESS++;
    if (r.target_type === "promotion") flagCounts.PROMOTIONS_EVENTS++;
  }

  return {
    MZANSI_MARKET: {
      pendingFlags: flagCounts.MZANSI_MARKET,
      pendingContent: pendingListings || 0,
    },
    BUSINESS_ADS: {
      pendingFlags: flagCounts.BUSINESS_ADS,
      pendingContent: 0,
    },
    MALL_SHOPS: {
      pendingFlags: flagCounts.MALL_SHOPS,
      pendingContent: 0,
    },
    MZANSI_BUSINESS: {
      pendingFlags: flagCounts.MZANSI_BUSINESS,
      pendingContent: pendingMzansiBiz || 0,
    },
    PROMOTIONS_EVENTS: {
      pendingFlags: flagCounts.PROMOTIONS_EVENTS,
      pendingContent: pendingPromos || 0,
    },
  };
}

// ── Dashboard Area Summary ───────────────────────────────────

export interface AreaSummaryStats {
  totalPosted: number;
  pendingReview: number;
  liveCount: number;
  rejectedCount: number;
  topCategory: string | null;
  categoryBreakdown: { category: string; count: number }[];
}

/** Get per-area summary stats for the dashboard area cards */
export async function getDashboardAreaSummary(): Promise<
  Record<"MZANSI_MARKET" | "MZANSI_BUSINESS" | "PROMOTIONS_EVENTS", AreaSummaryStats>
> {
  const supabase = createAdminClient();

  // ── Mzansi Market (listings) ────────────────────────────────
  const [
    { count: listingsTotal },
    { count: listingsPending },
    { count: listingsLive },
    { count: listingsRejected },
    { data: listingCategories },
  ] = await Promise.all([
    supabase.from("listings").select("*", { count: "exact", head: true }),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
    supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "live"),
    supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "rejected"),
    supabase.from("listings").select("category").eq("status", "live"),
  ]);

  const listingCatBreakdown = buildCategoryBreakdown(listingCategories || []);

  // ── Mzansi Business (businesses) ────────────────────────────
  const [
    { count: bizTotal },
    { count: bizPending },
    { count: bizLive },
    { count: bizRejected },
    { data: bizCategories },
  ] = await Promise.all([
    supabase.from("businesses").select("*", { count: "exact", head: true }),
    supabase
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
    supabase.from("businesses").select("*", { count: "exact", head: true }).eq("status", "live"),
    supabase
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("status", "rejected"),
    supabase.from("businesses").select("category").eq("status", "live"),
  ]);

  const bizCatBreakdown = buildCategoryBreakdown(bizCategories || []);

  // ── Tourism & Events ─────────────────────────────────────
  const [
    { count: promoTotal },
    { count: promoPending },
    { count: promoLive },
    { count: promoRejected },
    { data: promoCategories },
  ] = await Promise.all([
    supabase.from("promotions").select("*", { count: "exact", head: true }),
    supabase
      .from("promotions")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
    supabase.from("promotions").select("*", { count: "exact", head: true }).eq("status", "live"),
    supabase
      .from("promotions")
      .select("*", { count: "exact", head: true })
      .eq("status", "rejected"),
    supabase.from("promotions").select("promotion_type").eq("status", "live"),
  ]);

  const promoCatBreakdown = buildCategoryBreakdown(
    (promoCategories || []).map((p) => ({
      category: (p as { promotion_type: string }).promotion_type,
    }))
  );

  return {
    MZANSI_MARKET: {
      totalPosted: listingsTotal || 0,
      pendingReview: listingsPending || 0,
      liveCount: listingsLive || 0,
      rejectedCount: listingsRejected || 0,
      topCategory: listingCatBreakdown[0]?.category || null,
      categoryBreakdown: listingCatBreakdown,
    },
    MZANSI_BUSINESS: {
      totalPosted: bizTotal || 0,
      pendingReview: bizPending || 0,
      liveCount: bizLive || 0,
      rejectedCount: bizRejected || 0,
      topCategory: bizCatBreakdown[0]?.category || null,
      categoryBreakdown: bizCatBreakdown,
    },
    PROMOTIONS_EVENTS: {
      totalPosted: promoTotal || 0,
      pendingReview: promoPending || 0,
      liveCount: promoLive || 0,
      rejectedCount: promoRejected || 0,
      topCategory: promoCatBreakdown[0]?.category || null,
      categoryBreakdown: promoCatBreakdown,
    },
  };
}

/** Build sorted category breakdown from raw rows with a `category` field */
function buildCategoryBreakdown(
  rows: Array<{ category?: string | null }>
): { category: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const cat = row.category || "uncategorized";
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

/** Get pending verification steps with account display name */
export async function getPendingVerifications(limit = 50): Promise<PendingVerification[]> {
  const supabase = createAdminClient();

  const { data: steps } = await supabase
    .from("verification_steps")
    .select(
      "id, user_id, step_type, status, created_at, risk_level, risk_score, auto_status, reviewed_at"
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
    BUSINESS_ADS: ["business"],
    MALL_SHOPS: ["business"],
    MZANSI_BUSINESS: ["business", "business_profile", "storefront"],
    PROMOTIONS_EVENTS: ["promotion"],
  };

  const { data } = await supabase
    .from("reports")
    .select("*")
    .in("target_type", targetTypeMap[area])
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(100);

  return data || [];
}

/** Get content pending moderation for an area */
export async function getPendingContent(area: MarketplaceArea) {
  const supabase = createAdminClient();

  const tableMap: Record<MarketplaceArea, string> = {
    MZANSI_MARKET: "listings",
    BUSINESS_ADS: "businesses",
    MALL_SHOPS: "businesses",
    MZANSI_BUSINESS: "businesses",
    PROMOTIONS_EVENTS: "promotions",
  };

  const { data } = await supabase
    .from(tableMap[area])
    .select("*")
    .eq("status", "pending_moderation")
    .order("created_at", { ascending: true })
    .limit(50);

  return data || [];
}

// ── Dashboard-specific richer queries ────────────────────────

export interface DashboardKycItem {
  id: string;
  user_id: string;
  step_type: string;
  status: string;
  full_name: string | null;
  dob: string | null;
  document_type: string | null;
  location_method: string | null;
  location_province: string | null;
  location_city: string | null;
  location_address_line: string | null;
  submitted_at: string | null;
  created_at: string;
  risk_level: string | null;
  risk_score: number | null;
  auto_status: string | null;
  account_display_name?: string | null;
  account_verification_status?: string | null;
  account_status?: string | null;
  account_strikes?: number;
  /** @deprecated Use account_display_name */
  /** @deprecated Use account_verification_status */
  /** @deprecated Use account_status */
  /** @deprecated Use account_strikes */
}

/** Get pending KYC steps with full metadata for the dashboard command centre */
export async function getDashboardKycQueue(limit = 50): Promise<DashboardKycItem[]> {
  const supabase = createAdminClient();

  const { data: steps } = await supabase
    .from("verification_steps")
    .select(
      "id, user_id, step_type, status, full_name, dob, document_type, location_method, location_province, location_city, location_address_line, submitted_at, created_at, risk_level, risk_score, auto_status"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!steps?.length) return [];

  const userIds = Array.from(new Set(steps.map((s) => s.user_id))) as string[];

  const profileMap = await getVerificationProfileMap(
    supabase,
    userIds,
    "user_id, display_name, account_verification_status, account_status, strikes"
  );

  return steps.map((s) => {
    const profile = profileMap.get(s.user_id);
    return {
      ...s,
      account_display_name: profile?.display_name || null,
      account_verification_status: readAccountVerificationStatus(profile),
      account_status: profile?.account_status || null,
      account_strikes: profile?.strikes || 0,
    };
  });
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

/** Get all open reports across areas, high-severity and oldest first */
export async function getDashboardReports(limit = 30): Promise<DashboardReport[]> {
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("reports")
    .select(
      "id, target_id, target_type, area, category, severity, status, description, reporter_user_id, created_at"
    )
    .in("status", ["open", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(limit);

  // Sort: high severity first, then oldest within same severity
  const rows = (data as DashboardReport[]) || [];
  return rows.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "high" ? -1 : 1;
    }
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

// ── Verification funnel & extended platform stats ─────────────

export interface VerificationStepCounts {
  phone: number;
  id_doc: number;
  selfie: number;
  location: number;
  total: number;
}

/** Count pending verification steps broken down by step type */
export async function getVerificationStepCounts(): Promise<VerificationStepCounts> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("verification_steps")
    .select("step_type")
    .eq("status", "pending");

  const counts: VerificationStepCounts = { phone: 0, id_doc: 0, selfie: 0, location: 0, total: 0 };
  for (const row of (data || []) as { step_type: string }[]) {
    const t = row.step_type;
    if (t === "location") continue; // Location is self-service, exclude from admin counts
    if (t === "phone") counts.phone++;
    else if (t === "id_doc") counts.id_doc++;
    else if (t === "selfie") counts.selfie++;
    counts.total++;
  }
  return counts;
}

export interface ExtendedPlatformStats {
  verifiedAccounts: number;
  bannedAccounts: number;
  verifiedMembers: number;
  bannedMembers: number;
  liveListings: number;
  hiddenListings: number;
}

async function getContentStatusTotalsInternal(status: "live" | "hidden") {
  const supabase = createAdminClient();

  const [{ count: listings }, { count: businesses }, { count: promotions }] = await Promise.all([
    supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", status),
    supabase.from("businesses").select("*", { count: "exact", head: true }).eq("status", status),
    supabase.from("promotions").select("*", { count: "exact", head: true }).eq("status", status),
  ]);

  return (listings || 0) + (businesses || 0) + (promotions || 0);
}

/** Get extended platform stats beyond the basic dashboard stats */
export async function getExtendedPlatformStats(): Promise<ExtendedPlatformStats> {
  const supabase = createAdminClient();
  const [{ count: verifiedAccounts }, { count: bannedMembers }, liveListings, hiddenListings] =
    await Promise.all([
      supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("*", { count: "exact", head: true })
        .or("account_verification_status.eq.verified"),
      supabase
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("account_status", "banned"),
      getContentStatusTotalsInternal("live"),
      getContentStatusTotalsInternal("hidden"),
    ]);
  return {
    verifiedAccounts: verifiedAccounts || 0,
    bannedAccounts: bannedMembers || 0,
    verifiedMembers: verifiedAccounts || 0,
    bannedMembers: bannedMembers || 0,
    liveListings: liveListings || 0,
    hiddenListings: hiddenListings || 0,
  };
}

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
