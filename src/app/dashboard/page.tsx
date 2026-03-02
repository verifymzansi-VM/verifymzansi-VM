import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Package,
  Eye,
  MessageSquare,
  TrendingUp,
  ArrowRight,
  ShieldCheck,
  Plus,
  Megaphone,
  Store,
  Briefcase,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TrustBadge } from "@/components/trust/trust-badge";
import { VerificationProgress } from "@/components/trust/verification-progress";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { AttentionBanner } from "@/components/dashboard/attention-banner";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/recent-activity";
import type { VerificationStepType, VerificationStatus } from "@/types/enums";

export const metadata = {
  title: "Dashboard | VerifyMzansi",
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

  // Fetch all data in parallel for maximum performance
  const [
    profileResult,
    verificationStepsResult,
    activeListingsResult,
    sellerListingsResult,
    unreadLeadsResult,
    totalLeadsResult,
    activePromosResult,
    rejectedListingsResult,
    pendingModerationResult,
    expiringListingsResult,
    expiringPromosResult,
    storefrontCountResult,
    businessProfileCountResult,
    recentLeadsResult,
    recentListingChangesResult,
  ] = await Promise.all([
    // Seller profile
    supabase.from("seller_profiles").select("*").eq("user_id", user.id).single(),
    // Verification steps
    supabase.from("verification_steps").select("step_type, status").eq("user_id", user.id),
    // Active listings count
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "live"),
    // All seller listings (for views query + activity)
    supabase
      .from("listings")
      .select("id, title, status, created_at, updated_at")
      .eq("seller_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50),
    // Unread leads count (NEW — the key actionable metric)
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "new"),
    // Total leads count
    supabase
      .from("contact_events")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id),
    // Active promotions count
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "live")
      .or(`boost_until.gt.${now},featured_until.gt.${now},urgent_until.gt.${now}`),
    // Rejected listings count (NEW — needs attention)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "rejected"),
    // Pending moderation count (NEW — needs attention)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .in("status", ["pending_moderation", "flagged_for_review"]),
    // Expiring listings count (NEW — within 7 days)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "live")
      .lt("expires_at", sevenDaysFromNow)
      .gt("expires_at", now),
    // Expiring promotions count (NEW — within 48 hours)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "live")
      .or(
        `boost_until.gt.${now}.lt.${fortyEightHoursFromNow},featured_until.gt.${now}.lt.${fortyEightHoursFromNow},urgent_until.gt.${now}.lt.${fortyEightHoursFromNow}`
      ),
    // Storefront count (NEW — for quick actions)
    supabase
      .from("storefronts")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id),
    // Business profile count (NEW — for quick actions)
    supabase
      .from("business_profiles")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id),
    // Recent leads for activity feed
    supabase
      .from("leads")
      .select("id, buyer_name, message, created_at")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    // Recent listing status changes for activity feed
    supabase
      .from("listings")
      .select("id, title, status, created_at, updated_at")
      .eq("seller_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const profile = profileResult.data;
  const verificationSteps = verificationStepsResult.data;
  const activeListings = activeListingsResult.count;
  const sellerListings = sellerListingsResult.data;
  const listingIds = sellerListings?.map((l) => l.id) ?? [];
  const unreadLeadCount = unreadLeadsResult.count || 0;
  const totalLeadCount = totalLeadsResult.count || 0;
  const activePromos = activePromosResult.count;
  const rejectedListingCount = rejectedListingsResult.count || 0;
  const pendingModerationCount = pendingModerationResult.count || 0;
  const expiringListingCount = expiringListingsResult.count || 0;
  const expiringPromoCount = expiringPromosResult.count || 0;
  const storefrontCount = storefrontCountResult.count || 0;
  const businessProfileCount = businessProfileCountResult.count || 0;

  // Fetch total views (depends on listingIds)
  const { count: totalViews } =
    listingIds.length > 0
      ? await supabase
          .from("listing_views")
          .select("*", { count: "exact", head: true })
          .in("target_id", listingIds)
      : { count: 0 };

  // Compute conversion rate
  const conversionRate =
    (totalViews || 0) > 0 ? ((totalLeadCount / (totalViews || 1)) * 100).toFixed(1) : "0.0";

  const trustLevel = computeTrustLevel(
    profile?.seller_verification_status ?? "incomplete",
    undefined,
    profile?.account_status,
    { strikes: profile?.strikes ?? 0, legalHold: profile?.legal_hold ?? false }
  );

  const verificationProgressSteps =
    verificationSteps?.map((s: { step_type: string; status: string }) => ({
      type: s.step_type as VerificationStepType,
      status: s.status as VerificationStatus,
    })) || [];

  const displayName = profile?.display_name || user.user_metadata?.display_name || "Seller";

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
        });
      } else if (listing.status === "rejected") {
        activityItems.push({
          id: `listing-rej-${listing.id}`,
          type: "listing_rejected",
          title: `"${titleSnippet}" was rejected`,
          description: "Check the rejection reason and edit your listing.",
          timestamp: listing.updated_at || listing.created_at,
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
        });
      }
    }
  }

  // Sort by timestamp descending, take top 10
  activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentActivity = activityItems.slice(0, 10);

  // Check if there are any items needing attention
  const hasAttentionItems =
    rejectedListingCount > 0 ||
    unreadLeadCount > 0 ||
    pendingModerationCount > 0 ||
    expiringListingCount > 0 ||
    expiringPromoCount > 0 ||
    trustLevel < 4;

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome back, ${displayName}`}>
        <Button asChild variant="trust-verified" size="sm" className="gap-2">
          <Link href="/post/create">
            <Plus className="h-4 w-4" />
            Post Ad
          </Link>
        </Button>
      </PageHeader>

      {/* Attention Banners — dismissible alerts for urgent items */}
      <AttentionBanner
        trustLevel={trustLevel}
        unreadLeadCount={unreadLeadCount}
        rejectedListingCount={rejectedListingCount}
        pendingModerationCount={pendingModerationCount}
        expiringPromoCount={expiringPromoCount}
      />

      {/* Needs Attention — clickable cards for items needing action */}
      {hasAttentionItems && (
        <NeedsAttention
          unreadLeadCount={unreadLeadCount}
          rejectedListingCount={rejectedListingCount}
          pendingModerationCount={pendingModerationCount}
          expiringListingCount={expiringListingCount}
          expiringPromoCount={expiringPromoCount}
          trustLevel={trustLevel}
        />
      )}

      {/* Trust & Verification */}
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
          {trustLevel < 4 && (
            <Button asChild variant="outline" size="sm" className="mt-3 inline-flex gap-1">
              <Link href="/verification">
                Increase Trust Level
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Stats Grid — all cards are now clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Link href="/dashboard/listings">
          <Card className="hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-brand-green-50 dark:bg-brand-green-950 text-brand-green">
                  <Package className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{activeListings || 0}</p>
                  <p className="text-xs text-muted-foreground">Active Listings</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/metrics">
          <Card className="hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950 text-blue-600">
                  <Eye className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{totalViews || 0}</p>
                  <p className="text-xs text-muted-foreground">Total Views</p>
                  <p className="text-[10px] text-muted-foreground">{conversionRate}% conversion</p>
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
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-950 text-purple-600">
                  <Megaphone className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display">{activePromos || 0}</p>
                  <p className="text-xs text-muted-foreground">Active Promos</p>
                  {expiringPromoCount > 0 && (
                    <p className="text-[10px] text-amber-600">{expiringPromoCount} expiring soon</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/verification">
          <Card className="hover:shadow-md transition-all cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-brand-green-50 dark:bg-brand-green-950 text-brand-green">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-display capitalize">{trustLevel}/4</p>
                  <p className="text-xs text-muted-foreground">Trust Level</p>
                  <p className="text-[10px] text-muted-foreground">
                    {trustLevel >= 4
                      ? "Fully verified"
                      : `${4 - trustLevel} step${4 - trustLevel > 1 ? "s" : ""} remaining`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Quick Actions — with counts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/dashboard/listings">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <Package className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">Manage Listings</span>
              {(rejectedListingCount > 0 || pendingModerationCount > 0) && (
                <span className="ml-auto mr-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {rejectedListingCount + pendingModerationCount}
                </span>
              )}
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/promotions">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <Megaphone className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">Manage Promotions</span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/leads">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">View Leads</span>
              {unreadLeadCount > 0 && (
                <span className="ml-auto mr-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-bold text-white">
                  {unreadLeadCount}
                </span>
              )}
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/storefronts">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <Store className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                Storefronts{storefrontCount > 0 ? ` (${storefrontCount})` : ""}
              </span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Secondary Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link href="/dashboard/business-profiles">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <Briefcase className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                Business Profiles{businessProfileCount > 0 ? ` (${businessProfileCount})` : ""}
              </span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/metrics">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">View Metrics</span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/billing">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">Upgrade Plan</span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent Activity Feed */}
      <RecentActivity items={recentActivity} />
    </div>
  );
}
