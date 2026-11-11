import { toContentEditModerationItem } from "@/lib/content-edit-moderation";
import { withAllPrivateFields } from "@/lib/content/private-fields";
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
 * Admin query helpers — shared data-fetching for admin pages. Queue,
 * activity and report reads come from the foundation staff commands.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { MarketplaceArea } from "@/types/enums";
import type { NativeIdentityScope } from "@/lib/admin/native-identity-review";
import type { ReportItem } from "@/lib/admin/report-item";

// ── Types ────────────────────────────────────────────────────

export interface PendingVerification {
  claim_case_id?: string;
  foundation?: NativeIdentityScope;
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
  actor_id: string | null;
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

// ── Queries ──────────────────────────────────────────────────

/** How many identity checks are waiting in total, whatever is shown. */
export async function countPendingVerifications(): Promise<number> {
  const { readRestoredStaffVerificationQueue } =
    await import("@/lib/foundation/staff-verification-server");
  return (await readRestoredStaffVerificationQueue()).total;
}

export async function getPendingVerificationGroups(
  limit = 50,
  options: { includeIds?: string[] } = {}
): Promise<PendingVerificationGroup[]> {
  const { readRestoredStaffVerificationQueue } =
    await import("@/lib/foundation/staff-verification-server");
  return (
    await readRestoredStaffVerificationQueue(
      Math.min(limit, 100),
      JSON.stringify(options.includeIds ?? [])
    )
  ).groups;
}

/** Get recent audit log entries */
export async function getRecentActivity(limit = 20, area?: string): Promise<AuditLogEntry[]> {
  const { readNativeAreaActivity } = await import("@/lib/foundation/area-activity-server");
  return (await readNativeAreaActivity(area, limit)).items;
}

/**
 * Open and in-progress reports for an area, oldest first. Filtered in the
 * database (`reports.area` is required), so a busy area never hides another
 * area's reports behind a shared limit. Throws when the read fails.
 */
export async function getAreaReports(area: MarketplaceArea) {
  const { readNativeProgramReports } = await import("@/lib/foundation/area-activity-server");
  return (await readNativeProgramReports(area)).open;
}

// getPendingContent, getSiteVisitStats and getShowroomExposureReport have no
// foundation read yet: they still use the retired service client, which
// reaches no tables in production, so the panels show their unavailable state.

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
    // Contact details and address come from the server-only private table.
    return (await withAllPrivateFields("businesses", businesses)).map(businessItem);
  }

  if (area === "PROMOTIONS_EVENTS") {
    const [promotions, tourismBusinesses] = await Promise.all([
      pending("promotions", PROMOTION_FIELDS),
      pending("businesses", BUSINESS_FIELDS).or(TOURISM_BUSINESS_FILTER),
    ]);
    return oldestFirst([
      ...rowsOrThrow(promotions).map(promotionItem),
      ...(await withAllPrivateFields("businesses", rowsOrThrow(tourismBusinesses))).map(
        businessItem
      ),
    ]);
  }

  return [];
}

/** Content pending moderation for an area. */
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

export type DashboardReport = ReportItem;

// ── Verification funnel & extended platform stats ─────────────

/** Count moderation actions taken today, grouped by action type */
export async function getActionsToday(area?: string): Promise<Record<string, number>> {
  const { readNativeAreaActivity } = await import("@/lib/foundation/area-activity-server");
  return (await readNativeAreaActivity(area)).today;
}

// ── Site visit analytics (admin home) ─────────────────────────

export interface SiteVisitDailyPoint {
  date: string; // YYYY-MM-DD
  visits: number;
  visitors: number;
  /** Content views (video plays and post page opens) that day. */
  postViews?: number;
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
  /** Post views (views v2): one per person, per post, per 30 minutes. */
  postViewsToday: number;
  postViews7d: number;
  postViews30d: number;
  videoViews7d: number;
  engagedViews7d: number;
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
  postViewsToday: 0,
  postViews7d: 0,
  postViews30d: 0,
  videoViews7d: 0,
  engagedViews7d: 0,
};

/** One database snapshot; aggregate results are not subject to REST row limits. */
export async function getSiteVisitStats(): Promise<SiteVisitStats> {
  try {
    const { data, error } = await createAdminClient().rpc("get_site_visit_stats");
    if (error || !data) return EMPTY_SITE_VISIT_STATS;
    return {
      ...EMPTY_SITE_VISIT_STATS,
      ...(data as Partial<Omit<SiteVisitStats, "available">>),
      available: true,
    };
  } catch {
    return EMPTY_SITE_VISIT_STATS;
  }
}

// ── Showroom fairness (admin home) ────────────────────────────

export interface ShowroomSurfaceExposure {
  surface: "home" | "business" | "market" | "tourism";
  posts: number;
  appearances7d: number;
  fairShare7d: number | null;
  lowest7d: number;
  highest7d: number;
}

export interface ZeroExposurePost {
  surface: ShowroomSurfaceExposure["surface"];
  table: "businesses" | "listings" | "promotions";
  id: string;
  title: string;
  province: string | null;
  liveSince: string;
}

export interface ShowroomExposureReport {
  available: boolean;
  surfaces: ShowroomSurfaceExposure[];
  zeroExposure: ZeroExposurePost[];
}

/** Fair-rotation health: appearances per showroom and posts nobody saw in 24h. */
export async function getShowroomExposureReport(): Promise<ShowroomExposureReport> {
  try {
    const { data, error } = await createAdminClient().rpc("get_showroom_exposure_report");
    if (error || !data) return { available: false, surfaces: [], zeroExposure: [] };
    const report = data as Partial<ShowroomExposureReport>;
    return {
      available: true,
      surfaces: report.surfaces ?? [],
      zeroExposure: report.zeroExposure ?? [],
    };
  } catch {
    return { available: false, surfaces: [], zeroExposure: [] };
  }
}
