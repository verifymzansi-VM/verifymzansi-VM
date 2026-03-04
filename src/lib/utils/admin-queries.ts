/**
 * Admin query helpers — shared data-fetching for admin pages.
 * Uses server-side Supabase client (anon key + user session for RLS).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { MarketplaceArea } from "@/types/enums";

// ── Types ────────────────────────────────────────────────────

export interface AdminDashboardStats {
  totalSellers: number;
  totalListings: number;
  openReports: number;
  pendingVerifications: number;
  activeSuspensions: number;
  pendingModeration: number;
}

export interface AreaStats {
  pendingFlags: number;
  highSeverityOverdue: number;
  actionsToday: Record<string, number>;
  avgResolutionHours: number | null;
  pendingContent: number;
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
  seller_display_name: string | null;
  seller_verification_status: string | null;
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

// ── Queries ──────────────────────────────────────────────────

/** Fetch all high-level stats for the admin dashboard */
export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  const supabase = createAdminClient();

  const [
    { count: totalSellers },
    { count: totalListings },
    { count: openReports },
    { count: pendingVerifications },
    { count: activeSuspensions },
    { count: pendingModeration },
  ] = await Promise.all([
    supabase.from("seller_profiles").select("*", { count: "exact", head: true }),
    supabase.from("listings").select("*", { count: "exact", head: true }),
    supabase.from("reports").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase
      .from("verification_steps")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("seller_profiles")
      .select("*", { count: "exact", head: true })
      .eq("account_status", "suspended"),
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_moderation"),
  ]);

  return {
    totalSellers: totalSellers || 0,
    totalListings: totalListings || 0,
    openReports: openReports || 0,
    pendingVerifications: pendingVerifications || 0,
    activeSuspensions: activeSuspensions || 0,
    pendingModeration: pendingModeration || 0,
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
    .eq("status", "open");

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
    if (r.target_type === "listing") flagCounts.MZANSI_MARKET++;
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

  // ── Promotions & Events ─────────────────────────────────────
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

/** Get pending verification steps with seller display name */
export async function getPendingVerifications(limit = 50): Promise<PendingVerification[]> {
  const supabase = createAdminClient();

  const { data: steps } = await supabase
    .from("verification_steps")
    .select("id, user_id, step_type, status, created_at, risk_level, risk_score, auto_status")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!steps?.length) return [];

  // Get seller profiles for each user

  const userIds = Array.from(new Set(steps.map((s) => s.user_id))) as string[];
  const { data: profiles } = await supabase
    .from("seller_profiles")
    .select("user_id, display_name, seller_verification_status")
    .in("user_id", userIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p] as const));

  return steps.map((s) => {
    const profile = profileMap.get(s.user_id);
    return {
      ...s,
      seller_display_name: profile?.display_name || null,
      seller_verification_status: profile?.seller_verification_status || null,
    };
  });
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

  // Map area to target_type
  const targetTypeMap: Record<MarketplaceArea, string> = {
    MZANSI_MARKET: "listing",
    BUSINESS_ADS: "business",
    MALL_SHOPS: "business",
    MZANSI_BUSINESS: "business",
    PROMOTIONS_EVENTS: "promotion",
  };

  const { data } = await supabase
    .from("reports")
    .select("*")
    .eq("target_type", targetTypeMap[area])
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
  submitted_at: string | null;
  created_at: string;
  risk_level: string | null;
  risk_score: number | null;
  auto_status: string | null;
  seller_display_name: string | null;
  seller_verification_status: string | null;
  seller_account_status: string | null;
  seller_strikes: number;
}

/** Get pending KYC steps with full metadata for the dashboard command centre */
export async function getDashboardKycQueue(limit = 50): Promise<DashboardKycItem[]> {
  const supabase = createAdminClient();

  const { data: steps } = await supabase
    .from("verification_steps")
    .select(
      "id, user_id, step_type, status, full_name, dob, document_type, location_method, location_province, location_city, submitted_at, created_at, risk_level, risk_score, auto_status"
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (!steps?.length) return [];

  const userIds = Array.from(new Set(steps.map((s) => s.user_id))) as string[];

  const { data: profiles } = await supabase
    .from("seller_profiles")
    .select("user_id, display_name, seller_verification_status, account_status, strikes")
    .in("user_id", userIds);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p] as const));

  return steps.map((s) => {
    const profile = profileMap.get(s.user_id);
    return {
      ...s,
      seller_display_name: profile?.display_name || null,
      seller_verification_status: profile?.seller_verification_status || null,
      seller_account_status: profile?.account_status || null,
      seller_strikes: profile?.strikes || 0,
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

export interface DashboardContentItem {
  id: string;
  title: string;
  area: "MZANSI_MARKET" | "BUSINESS_ADS" | "MALL_SHOPS" | "MZANSI_BUSINESS";
  areaLabel: string;
  itemType: string;
  category: string | null;
  seller_id: string | null;
  created_at: string;
  status: string;
}

/** Get all pending-moderation content across all areas */
export async function getDashboardContentQueue(): Promise<DashboardContentItem[]> {
  const supabase = createAdminClient();

  const [{ data: pendingListings }, { data: pendingBusinesses }] = await Promise.all([
    supabase
      .from("listings")
      .select("id, title, status, created_at, category, seller_id")
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(30),
    supabase
      .from("businesses")
      .select("id, business_name, business_type, status, created_at, category, seller_id")
      .eq("status", "pending_moderation")
      .order("created_at", { ascending: true })
      .limit(30),
  ]);

  return [
    ...(pendingListings || []).map((l) => ({
      id: l.id,
      title: l.title || `Listing ${l.id.slice(0, 8)}`,
      area: "MZANSI_MARKET" as const,
      areaLabel: "Mzansi Market",
      itemType: "Listing",
      category: l.category || null,
      seller_id: l.seller_id || null,
      created_at: l.created_at,
      status: l.status,
    })),
    ...(pendingBusinesses || []).map((b) => ({
      id: b.id,
      title: b.business_name || `Business ${b.id.slice(0, 8)}`,
      area: "MZANSI_BUSINESS" as const,
      areaLabel: "Mzansi Business",
      itemType: "Business",
      category: b.category || null,
      seller_id: b.seller_id || null,
      created_at: b.created_at,
      status: b.status,
    })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
    if (t === "phone") counts.phone++;
    else if (t === "id_doc") counts.id_doc++;
    else if (t === "selfie") counts.selfie++;
    else if (t === "location") counts.location++;
    counts.total++;
  }
  return counts;
}

export interface ExtendedPlatformStats {
  verifiedSellers: number;
  bannedSellers: number;
  liveListings: number;
  hiddenListings: number;
}

/** Get extended platform stats beyond the basic dashboard stats */
export async function getExtendedPlatformStats(): Promise<ExtendedPlatformStats> {
  const supabase = createAdminClient();
  const [
    { count: verifiedSellers },
    { count: bannedSellers },
    { count: liveListings },
    { count: hiddenListings },
  ] = await Promise.all([
    supabase
      .from("seller_profiles")
      .select("*", { count: "exact", head: true })
      .eq("seller_verification_status", "verified"),
    supabase
      .from("seller_profiles")
      .select("*", { count: "exact", head: true })
      .eq("account_status", "banned"),
    supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "live"),
    supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "hidden"),
  ]);
  return {
    verifiedSellers: verifiedSellers || 0,
    bannedSellers: bannedSellers || 0,
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

/** Count moderation actions taken today by a specific user */
export async function getMyActionsToday(userId: string): Promise<Record<string, number>> {
  const supabase = createAdminClient();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("moderation_actions")
    .select("action")
    .eq("actor_id", userId)
    .gte("created_at", todayStart.toISOString());

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    const a = (row as { action: string }).action;
    counts[a] = (counts[a] || 0) + 1;
  }
  return counts;
}
