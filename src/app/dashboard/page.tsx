import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, BadgeCheck, ShieldCheck, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ACCOUNT_PROFILE_TABLE,
  applyOwnerFilter,
  getOwnerColumn,
  type OwnerColumn,
} from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { getOptionalContentViewCountMap } from "@/lib/engagement-server";
import { EmailConfirmedToast } from "@/components/dashboard/email-confirmed-toast";
import { DashboardOnboarding } from "@/components/dashboard/dashboard-onboarding";
import {
  ListingManagerMini,
  type MiniListingPost,
} from "@/components/dashboard/listing-manager-mini";
import { QuickLinks } from "@/components/dashboard/quick-links";
import { DashboardLiveLeadAlerts } from "@/components/dashboard/dashboard-live-lead-alerts";

/** Safely resolve owner column — fall back to "owner_id" on error. */
async function safeGetOwnerColumn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: Parameters<typeof getOwnerColumn>[1]
): Promise<OwnerColumn> {
  try {
    return await getOwnerColumn(supabase, table);
  } catch {
    return "owner_id";
  }
}

/** Supabase-shaped empty response for use as a fallback. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const EMPTY_OK = { data: null, count: 0, error: null, status: 200, statusText: "OK" } as any;
const EMPTY_LIST_OK = {
  data: [] as never[],
  count: 0,
  error: null,
  status: 200,
  statusText: "OK",
} as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Extract value from a settled promise, returning a fallback on rejection. */
function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === "fulfilled" ? result.value : fallback;
}

export const metadata = {
  title: "Dashboard",
  description: "Your VerifyMzansi dashboard — manage posts, leads, and businesses in one place.",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const sevenDaysFromNow = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const fortyEightHoursFromNow = new Date(nowDate.getTime() + 48 * 60 * 60 * 1000).toISOString();

  const [listingOwnerColumn, businessOwnerColumn, leadsOwnerColumn, promotionsOwnerColumn] =
    await Promise.all([
      safeGetOwnerColumn(supabase, "listings"),
      safeGetOwnerColumn(supabase, "businesses"),
      safeGetOwnerColumn(supabase, "leads"),
      safeGetOwnerColumn(supabase, "promotions"),
    ]);

  // Fetch dashboard data in parallel — allSettled for resilience on slow connections
  const results = await Promise.allSettled([
    /* 0 */ supabase.from(ACCOUNT_PROFILE_TABLE).select("*").eq("user_id", user.id).maybeSingle(),
    /* 1 */ supabase
      .from("verification_steps")
      .select("step_type, status, reviewed_at")
      .eq("user_id", user.id),
    /* 2 — recent listings (broader fetch: 10 items with all statuses for mini-manager) */
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("id, title, status, area, photos, view_count, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(10),
      listingOwnerColumn,
      user.id
    ),
    /* 3 */ applyOwnerFilter(
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "new"),
      leadsOwnerColumn,
      user.id
    ),
    /* 4 — active listings count */
    applyOwnerFilter(
      supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "live"),
      listingOwnerColumn,
      user.id
    ),
    /* 5 — active promotions count */
    applyOwnerFilter(
      supabase
        .from("promotions")
        .select("*", { count: "exact", head: true })
        .eq("status", "live")
        .eq("promotion_type", "event")
        .or(`end_date.is.null,end_date.gte.${now}`),
      promotionsOwnerColumn,
      user.id
    ),
    /* 6 — rejected listings count */
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "rejected"),
      listingOwnerColumn,
      user.id
    ),
    /* 7 — pending moderation count */
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending_moderation", "flagged_for_review"]),
      listingOwnerColumn,
      user.id
    ),
    /* 8 — expiring listings */
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "live")
        .lt("expires_at", sevenDaysFromNow)
        .gt("expires_at", now),
      listingOwnerColumn,
      user.id
    ),
    /* 9 — expiring promotions */
    applyOwnerFilter(
      supabase
        .from("promotions")
        .select("*", { count: "exact", head: true })
        .eq("status", "live")
        .eq("promotion_type", "event")
        .gt("end_date", now)
        .lt("end_date", fortyEightHoursFromNow),
      promotionsOwnerColumn,
      user.id
    ),
    /* 10 — business count */
    applyOwnerFilter(
      supabase
        .from("businesses")
        .select("*", { count: "exact", head: true })
        .neq("category", "tourism_hospitality")
        .neq("area", "PROMOTIONS_EVENTS"),
      businessOwnerColumn,
      user.id
    ),
    /* 11 — tourism business count */
    applyOwnerFilter(
      supabase
        .from("businesses")
        .select("*", { count: "exact", head: true })
        .or("area.eq.PROMOTIONS_EVENTS,category.eq.tourism_hospitality"),
      businessOwnerColumn,
      user.id
    ),
    /* 12 — active entitlements (for plan label on quick links) */
    supabase
      .from("entitlements")
      .select("area, tier, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .gt("expires_at", now),
  ]);

  const profileResult = settled(results[0], EMPTY_OK);
  const verificationStepsResult = settled(results[1], EMPTY_LIST_OK);
  const ownerListingsResult = settled(results[2], EMPTY_LIST_OK);
  const unreadLeadsResult = settled(results[3], EMPTY_OK);
  const activeListingsResult = settled(results[4], EMPTY_OK);
  const activePromosResult = settled(results[5], EMPTY_OK);
  const rejectedListingsResult = settled(results[6], EMPTY_OK);
  const pendingModerationResult = settled(results[7], EMPTY_OK);
  const expiringListingsResult = settled(results[8], EMPTY_OK);
  const expiringPromosResult = settled(results[9], EMPTY_OK);
  const businessCountResult = settled(results[10], EMPTY_OK);
  const tourismBusinessCountResult = settled(results[11], EMPTY_OK);
  const entitlementsResult = settled(results[12], EMPTY_LIST_OK);

  const profile = profileResult.data;
  const verificationSteps = verificationStepsResult.data;
  const activeListings = activeListingsResult.count || 0;
  const unreadLeadCount = unreadLeadsResult.count || 0;
  const activePromos = activePromosResult.count || 0;
  const rejectedListingCount = rejectedListingsResult.count || 0;
  const pendingModerationCount = pendingModerationResult.count || 0;
  const expiringListingCount = expiringListingsResult.count || 0;
  const expiringPromoCount = expiringPromosResult.count || 0;
  const businessCount = businessCountResult.count || 0;
  const tourismEventsCount = activePromos + (tourismBusinessCountResult.count || 0);

  const verificationSummary = summarizeVerification(
    profile?.account_verification_status,
    verificationSteps
  );

  const trustLevel = computeTrustLevel(
    verificationSummary.accountVerificationStatus,
    undefined,
    profile?.account_status,
    { strikes: profile?.strikes ?? 0, legalHold: profile?.legal_hold ?? false }
  );

  const displayName = profile?.display_name || user.user_metadata?.display_name || "Member";
  const firstName = displayName.split(" ")[0];

  // Build posts for the mini listing manager
  const listingRows = ownerListingsResult.data ?? [];
  const listingIds = listingRows.map((listing: { id: string }) => listing.id);
  const listingViewCounts =
    listingIds.length > 0
      ? await getOptionalContentViewCountMap(tryCreateAdminClient(), "listing", listingIds)
      : { data: new Map<string, number>() };

  const posts: MiniListingPost[] = listingRows.map(
    (l: {
      id: string;
      title: string | null;
      status: string;
      area?: string | null;
      photos?: string[] | null;
      view_count?: number | null;
      created_at: string;
      updated_at?: string | null;
    }) => ({
      id: l.id,
      title: l.title,
      status: l.status,
      area: l.area,
      photos: l.photos,
      view_count: listingViewCounts.data.get(l.id) ?? l.view_count ?? null,
      created_at: l.created_at,
      updated_at: l.updated_at,
    })
  );

  // Plan tier label for quick links
  const activeEntitlements = entitlementsResult.data ?? [];
  const topTier =
    activeEntitlements.length > 0
      ? activeEntitlements.reduce((best: string, ent: { tier?: string }) => {
          const rank: Record<string, number> = { pro: 4, growth: 3, starter: 2, basic: 1 };
          const current = rank[ent.tier ?? ""] ?? 0;
          const bestRank = rank[best] ?? 0;
          return current > bestRank ? (ent.tier ?? best) : best;
        }, activeEntitlements[0]?.tier ?? "basic")
      : null;
  const planLabel = topTier
    ? topTier.charAt(0).toUpperCase() + topTier.slice(1) + " Plan"
    : undefined;

  // Verification chip helpers
  const isVerified = trustLevel >= 3;
  const verStatus = verificationSummary.accountVerificationStatus;
  const stepsRemaining = verificationSummary.stepsRemaining;
  const hasAnyPosts = posts.length > 0;
  const showDashboardOnboarding = !hasAnyPosts && businessCount === 0 && tourismEventsCount === 0;

  return (
    <div className="space-y-5">
      <EmailConfirmedToast />

      {/* ───── Compact header ───── */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold tracking-tight sm:text-2xl">
            Hi, {firstName}
          </h1>
          {/* Inline verification indicator */}
          {isVerified ? (
            <Badge className="mt-1.5 gap-1 bg-brand-green-50 text-brand-green border-brand-green-200 dark:bg-brand-green-950 dark:border-brand-green-800 text-xs">
              <BadgeCheck className="h-3 w-3" />
              Verified
            </Badge>
          ) : verStatus === "pending_review" ? (
            <Link
              href="/verification"
              className="-mx-2 mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-amber-600 dark:text-amber-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Verification under review
              <ChevronRight className="h-3 w-3" />
            </Link>
          ) : (
            <Link
              href="/verification"
              className="-mx-2 mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {stepsRemaining > 0
                ? `${stepsRemaining} step${stepsRemaining > 1 ? "s" : ""} to verify`
                : "Complete verification"}
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        <Button asChild size="sm" className="h-11 gap-1.5 flex-shrink-0">
          <Link href="/post/create">
            <Plus className="h-4 w-4" />
            <span className="hidden xs:inline">Create Post</span>
            <span className="xs:hidden">New Post</span>
          </Link>
        </Button>
      </div>

      <DashboardLiveLeadAlerts
        liveListings={activeListings}
        businesses={businessCount}
        activePromos={tourismEventsCount}
        initialUnreadLeadCount={unreadLeadCount}
        rejectedListingCount={rejectedListingCount}
        pendingModerationCount={pendingModerationCount}
        expiringListingCount={expiringListingCount}
        expiringPromoCount={expiringPromoCount}
        verificationStatus={verificationSummary.accountVerificationStatus}
        stepsRemaining={stepsRemaining}
      />

      {/* ───── Main content — responsive grid ───── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* Left: Fresh-start onboarding or listing manager */}
        {showDashboardOnboarding ? (
          <DashboardOnboarding
            isVerified={isVerified}
            verificationStatus={verificationSummary.accountVerificationStatus}
            hasListings={hasAnyPosts}
            hasBusinesses={businessCount > 0}
          />
        ) : (
          <ListingManagerMini posts={posts} />
        )}

        {/* Right: Quick links (stacks below on mobile) */}
        <QuickLinks planLabel={planLabel} />
      </div>
    </div>
  );
}
