import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ShoppingBag,
  MessageSquare,
  ArrowRight,
  ShieldCheck,
  Plus,
  Megaphone,
  Building2,
  Clock,
  BadgeCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { TrustBadge } from "@/components/trust/trust-badge";
import { VerificationProgress } from "@/components/trust/verification-progress";
import {
  ACCOUNT_PROFILE_TABLE,
  applyOwnerFilter,
  getOwnerColumn,
  type OwnerColumn,
} from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { AttentionBanner } from "@/components/dashboard/attention-banner";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/recent-activity";
import { EmailConfirmedToast } from "@/components/dashboard/email-confirmed-toast";
import { MyRecentPosts, type RecentPost } from "@/components/dashboard/my-recent-posts";
import { PlanSummary, type PlanInfo } from "@/components/dashboard/plan-summary";
import { DashboardOnboarding } from "@/components/dashboard/dashboard-onboarding";
import { getEntitlements } from "@/lib/services/entitlements";
import type {
  VerificationStepType,
  VerificationStatus,
  MarketplaceArea,
  PlanTier,
} from "@/types/enums";

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
  description:
    "Your VerifyMzansi dashboard — listings, businesses, verification status, and quick actions.",
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
  const [listingOwnerColumn, businessOwnerColumn, leadsOwnerColumn, contactOwnerColumn] =
    await Promise.all([
      safeGetOwnerColumn(supabase, "listings"),
      safeGetOwnerColumn(supabase, "businesses"),
      safeGetOwnerColumn(supabase, "leads"),
      safeGetOwnerColumn(supabase, "contact_events"),
    ]);

  // Fetch all data in parallel — use allSettled so a single query failure
  // does not crash the entire dashboard (common on slow mobile connections).
  const results = await Promise.allSettled([
    // Account profile (maybeSingle – new users may not have a profile yet)
    supabase.from(ACCOUNT_PROFILE_TABLE).select("*").eq("user_id", user.id).maybeSingle(),
    // Verification steps
    supabase.from("verification_steps").select("step_type, status").eq("user_id", user.id),
    // Active listings count
    applyOwnerFilter(
      supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "live"),
      listingOwnerColumn,
      user.id
    ),
    // All listing records for views, activity, and post previews
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("id, title, status, photos, view_count, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(50),
      listingOwnerColumn,
      user.id
    ),
    // Unread leads count (NEW — the key actionable metric)
    applyOwnerFilter(
      supabase.from("leads").select("*", { count: "exact", head: true }).eq("status", "new"),
      leadsOwnerColumn,
      user.id
    ),
    // Total leads count
    applyOwnerFilter(
      supabase.from("contact_events").select("*", { count: "exact", head: true }),
      contactOwnerColumn,
      user.id
    ),
    // Active promotions count
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "live")
        .or(`boost_until.gt.${now},featured_until.gt.${now},urgent_until.gt.${now}`),
      listingOwnerColumn,
      user.id
    ),
    // Rejected listings count (NEW — needs attention)
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "rejected"),
      listingOwnerColumn,
      user.id
    ),
    // Pending moderation count (NEW — needs attention)
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending_moderation", "flagged_for_review"]),
      listingOwnerColumn,
      user.id
    ),
    // Expiring listings count (NEW — within 7 days)
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
    // Expiring promotions count (NEW — within 48 hours)
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "live")
        .or(
          `and(boost_until.gt.${now},boost_until.lt.${fortyEightHoursFromNow}),and(featured_until.gt.${now},featured_until.lt.${fortyEightHoursFromNow}),and(urgent_until.gt.${now},urgent_until.lt.${fortyEightHoursFromNow})`
        ),
      listingOwnerColumn,
      user.id
    ),
    // Business count
    applyOwnerFilter(
      supabase.from("businesses").select("*", { count: "exact", head: true }),
      businessOwnerColumn,
      user.id
    ),
    // Active entitlements (for plan summary)
    supabase
      .from("entitlements")
      .select("area, tier, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .gt("expires_at", now),
    // Recent leads for activity feed
    applyOwnerFilter(
      supabase
        .from("leads")
        .select("id, buyer_name, message, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
      leadsOwnerColumn,
      user.id
    ),
    // Recent listing status changes for activity feed
    applyOwnerFilter(
      supabase
        .from("listings")
        .select("id, title, status, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(5),
      listingOwnerColumn,
      user.id
    ),
  ]);

  const emptyResult = EMPTY_OK;
  const emptyListResult = EMPTY_LIST_OK;
  const profileResult = settled(results[0], emptyResult);
  const verificationStepsResult = settled(results[1], emptyListResult);
  const activeListingsResult = settled(results[2], emptyResult);
  const ownerListingsResult = settled(results[3], emptyListResult);
  const unreadLeadsResult = settled(results[4], emptyResult);
  const totalLeadsResult = settled(results[5], emptyResult);
  const activePromosResult = settled(results[6], emptyResult);
  const rejectedListingsResult = settled(results[7], emptyResult);
  const pendingModerationResult = settled(results[8], emptyResult);
  const expiringListingsResult = settled(results[9], emptyResult);
  const expiringPromosResult = settled(results[10], emptyResult);
  const businessCountResult = settled(results[11], emptyResult);
  const entitlementsResult = settled(results[12], emptyListResult);
  const recentLeadsResult = settled(results[13], emptyListResult);
  const recentListingChangesResult = settled(results[14], emptyListResult);

  const profile = profileResult.data;
  const verificationSteps = verificationStepsResult.data;
  const activeListings = activeListingsResult.count;
  const ownerListings = ownerListingsResult.data;
  const listingIds = ownerListings?.map((l: { id: string }) => l.id) ?? [];
  const unreadLeadCount = unreadLeadsResult.count || 0;
  const totalLeadCount = totalLeadsResult.count || 0;
  const activePromos = activePromosResult.count;
  const rejectedListingCount = rejectedListingsResult.count || 0;
  const pendingModerationCount = pendingModerationResult.count || 0;
  const _expiringListingCount = expiringListingsResult.count || 0;
  const expiringPromoCount = expiringPromosResult.count || 0;
  const businessCount = businessCountResult.count || 0;

  // Fetch total views (depends on listingIds) — wrapped for resilience
  let totalViews = 0;
  try {
    if (listingIds.length > 0) {
      const viewsResult = await supabase
        .from("listing_views")
        .select("*", { count: "exact", head: true })
        .in("target_id", listingIds);
      totalViews = viewsResult.count ?? 0;
    }
  } catch {
    // Non-critical — default to 0
  }

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

  const verificationProgressSteps =
    verificationSteps?.map((s: { step_type: string; status: string }) => ({
      type: s.step_type as VerificationStepType,
      status: s.status as VerificationStatus,
    })) || [];

  const displayName = profile?.display_name || user.user_metadata?.display_name || "Member";

  // Build recent posts list for preview section
  const recentPosts: RecentPost[] = (ownerListings ?? [])
    .slice(0, 5)
    .map(
      (l: {
        id: string;
        title: string | null;
        status: string;
        photos?: string[] | null;
        view_count?: number | null;
        created_at: string;
      }) => ({
        id: l.id,
        title: l.title,
        status: l.status,
        photos: l.photos,
        view_count: l.view_count,
        created_at: l.created_at,
      })
    );

  // Build plan summary info
  const AREA_LABELS: Record<string, string> = {
    MZANSI_MARKET: "Market",
    MZANSI_BUSINESS: "Business",
    PROMOTIONS_EVENTS: "Promos",
  };
  const planInfos: PlanInfo[] = [];
  const activeEntitlements = entitlementsResult.data ?? [];
  for (const ent of activeEntitlements) {
    const areaLabel = AREA_LABELS[ent.area] ?? ent.area;
    const tierLabel = ent.tier ? ent.tier.charAt(0).toUpperCase() + ent.tier.slice(1) : "Free";
    const entitlementSet = getEntitlements(
      (ent.tier ?? "basic") as PlanTier,
      ent.area as MarketplaceArea
    );
    planInfos.push({
      area: ent.area,
      areaLabel,
      tierLabel,
      currentCount: 0, // approximate — exact count would need another query
      maxAllowed: entitlementSet.maxAllowed,
    });
  }

  const isNewUser = (activeListings ?? 0) === 0 && businessCount === 0;

  // Build activity feed from recent leads + listing changes
  const activityItems: ActivityItem[] = [];

  // Add recent leads
  if (recentLeadsResult.data) {
    for (const lead of recentLeadsResult.data) {
      activityItems.push({
        id: `lead-${lead.id}`,
        type: "lead",
        title: `New lead from ${lead.buyer_name || "a buyer"}`,
        description: lead.message ? lead.message.slice(0, 80) : undefined,
        timestamp: lead.created_at,
        href: "/dashboard/leads",
      });
    }
  }

  // Add recent listing changes
  if (recentListingChangesResult.data) {
    for (const listing of recentListingChangesResult.data) {
      const titleSnippet = listing.title?.slice(0, 40) || "Untitled listing";
      if (listing.status === "live") {
        activityItems.push({
          id: `listing-live-${listing.id}`,
          type: "listing_approved",
          title: `"${titleSnippet}" is now live`,
          timestamp: listing.updated_at || listing.created_at,
          href: "/dashboard/listings",
        });
      } else if (listing.status === "rejected") {
        activityItems.push({
          id: `listing-rej-${listing.id}`,
          type: "listing_rejected",
          title: `"${titleSnippet}" was rejected`,
          description: "Check the rejection reason and edit your listing.",
          timestamp: listing.updated_at || listing.created_at,
          href: "/dashboard/listings",
        });
      } else if (
        listing.status === "pending_moderation" ||
        listing.status === "flagged_for_review"
      ) {
        activityItems.push({
          id: `listing-pending-${listing.id}`,
          type: "listing_pending",
          title: `"${titleSnippet}" is under review`,
          timestamp: listing.updated_at || listing.created_at,
          href: "/dashboard/listings",
        });
      }
    }
  }

  // Sort by timestamp descending, take top 10
  activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentActivity = activityItems.slice(0, 10);

  return (
    <div className="space-y-6">
      <EmailConfirmedToast />
      <PageHeader title={`Welcome back, ${displayName}`} breadcrumbs={[{ label: "Dashboard" }]}>
        <div className="flex items-center gap-2">
          {trustLevel >= 3 && (
            <Badge className="bg-brand-green-50 text-brand-green border-brand-green-200 dark:bg-brand-green-950 dark:border-brand-green-800 gap-1">
              <BadgeCheck className="h-3 w-3" />
              Verified
            </Badge>
          )}
          <Button asChild variant="trust-verified" size="sm" className="gap-2">
            <Link href="/post/create">
              <Plus className="h-4 w-4" />
              Post Ad
            </Link>
          </Button>
        </div>
      </PageHeader>

      {/* Attention Banners — dismissible alerts for urgent items */}
      <AttentionBanner
        verificationStatus={verificationSummary.accountVerificationStatus}
        stepsRemaining={verificationSummary.stepsRemaining}
        unreadLeadCount={unreadLeadCount}
        rejectedListingCount={rejectedListingCount}
        pendingModerationCount={pendingModerationCount}
        expiringPromoCount={expiringPromoCount}
      />

      {/* Trust & Verification — only shown for unverified users */}
      {trustLevel < 3 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-display flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-brand-green" />
                Trust Status
              </CardTitle>
              <TrustBadge level={trustLevel} />
            </div>
          </CardHeader>
          <CardContent>
            <VerificationProgress steps={verificationProgressSteps} />
            {trustLevel === 2 ? (
              <p className="mt-3 text-sm text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-500" />
                Your documents are under review — we&apos;ll update your status within 24–48 hours.
              </p>
            ) : (
              <Button asChild variant="outline" size="sm" className="mt-3 inline-flex gap-1">
                <Link href="/verification">
                  Increase Trust Level
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats Grid — all cards are now clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/dashboard/listings">
          <Card className="hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-brand-green-50 dark:bg-brand-green-950 text-brand-green">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{activeListings || 0}</p>
                  <p className="text-xs text-muted-foreground">Mzansi Market</p>
                  <p className="text-[10px] text-muted-foreground">
                    {totalViews || 0} views · {totalLeadCount} enquiries
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/businesses">
          <Card className="hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{businessCount || 0}</p>
                  <p className="text-xs text-muted-foreground">Mzansi Business</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/leads">
          <Card className="hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-600 relative">
                  <MessageSquare className="h-5 w-5" />
                  {unreadLeadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {unreadLeadCount > 9 ? "9+" : unreadLeadCount}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{unreadLeadCount}</p>
                  <p className="text-xs text-muted-foreground">New Leads</p>
                  <p className="text-[10px] text-muted-foreground">{totalLeadCount} total</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/promotions">
          <Card className="hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950 text-red-500">
                  <Megaphone className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{activePromos || 0}</p>
                  <p className="text-xs text-muted-foreground">Promotions & Events</p>
                  {expiringPromoCount > 0 && (
                    <p className="text-[10px] text-amber-600">{expiringPromoCount} expiring soon</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Plan Summary */}
      {planInfos.length > 0 && <PlanSummary plans={planInfos} />}

      {/* New user onboarding OR post previews */}
      {isNewUser ? (
        <DashboardOnboarding isVerified={trustLevel >= 3} />
      ) : (
        <MyRecentPosts posts={recentPosts} />
      )}

      {/* Recent Activity Feed */}
      <RecentActivity items={recentActivity} />
    </div>
  );
}
