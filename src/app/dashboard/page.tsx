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
  Building2,
  Clock,
  CreditCard,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { TrustBadge } from "@/components/trust/trust-badge";
import { VerificationProgress } from "@/components/trust/verification-progress";
import { ACCOUNT_PROFILE_TABLE, readAccountVerificationStatus } from "@/lib/account/compat";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { AttentionBanner } from "@/components/dashboard/attention-banner";
import { NeedsAttention } from "@/components/dashboard/needs-attention";
import { RecentActivity, type ActivityItem } from "@/components/dashboard/recent-activity";
import { EmailConfirmedToast } from "@/components/dashboard/email-confirmed-toast";
import type { VerificationStepType, VerificationStatus } from "@/types/enums";

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

  // Fetch all data in parallel for maximum performance
  const [
    profileResult,
    verificationStepsResult,
    activeListingsResult,
    ownerListingsResult,
    unreadLeadsResult,
    totalLeadsResult,
    activePromosResult,
    rejectedListingsResult,
    pendingModerationResult,
    expiringListingsResult,
    expiringPromosResult,
    businessCountResult,
    recentLeadsResult,
    recentListingChangesResult,
  ] = await Promise.all([
    // Account profile (maybeSingle – new users may not have a profile yet)
    supabase.from(ACCOUNT_PROFILE_TABLE).select("*").eq("user_id", user.id).maybeSingle(),
    // Verification steps
    supabase.from("verification_steps").select("step_type, status").eq("user_id", user.id),
    // Active listings count
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("status", "live"),
    // All listing records for views and activity
    supabase
      .from("listings")
      .select("id, title, status, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(50),
    // Unread leads count (NEW — the key actionable metric)
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("status", "new"),
    // Total leads count
    supabase
      .from("contact_events")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id),
    // Active promotions count
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("status", "live")
      .or(`boost_until.gt.${now},featured_until.gt.${now},urgent_until.gt.${now}`),
    // Rejected listings count (NEW — needs attention)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("status", "rejected"),
    // Pending moderation count (NEW — needs attention)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .in("status", ["pending_moderation", "flagged_for_review"]),
    // Expiring listings count (NEW — within 7 days)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("status", "live")
      .lt("expires_at", sevenDaysFromNow)
      .gt("expires_at", now),
    // Expiring promotions count (NEW — within 48 hours)
    supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .eq("status", "live")
      .or(
        `and(boost_until.gt.${now},boost_until.lt.${fortyEightHoursFromNow}),and(featured_until.gt.${now},featured_until.lt.${fortyEightHoursFromNow}),and(urgent_until.gt.${now},urgent_until.lt.${fortyEightHoursFromNow})`
      ),
    // Business count (for quick actions)
    supabase.from("businesses").select("*", { count: "exact", head: true }).eq("owner_id", user.id),
    // Recent leads for activity feed
    supabase
      .from("leads")
      .select("id, buyer_name, message, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    // Recent listing status changes for activity feed
    supabase
      .from("listings")
      .select("id, title, status, created_at, updated_at")
      .eq("owner_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const profile = profileResult.data;
  const verificationSteps = verificationStepsResult.data;
  const activeListings = activeListingsResult.count;
  const ownerListings = ownerListingsResult.data;
  const listingIds = ownerListings?.map((l) => l.id) ?? [];
  const unreadLeadCount = unreadLeadsResult.count || 0;
  const totalLeadCount = totalLeadsResult.count || 0;
  const activePromos = activePromosResult.count;
  const rejectedListingCount = rejectedListingsResult.count || 0;
  const pendingModerationCount = pendingModerationResult.count || 0;
  const expiringListingCount = expiringListingsResult.count || 0;
  const expiringPromoCount = expiringPromosResult.count || 0;
  const businessCount = businessCountResult.count || 0;

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
    readAccountVerificationStatus(profile) ?? "incomplete",
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
    trustLevel <= 2;

  return (
    <div className="space-y-6">
      <EmailConfirmedToast />
      <PageHeader title={`Welcome back, ${displayName}`} breadcrumbs={[{ label: "Dashboard" }]}>
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
          {trustLevel === 2 ? (
            <p className="mt-3 text-sm text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-500" />
              Your documents are under review — we&apos;ll update your status within 24–48 hours.
            </p>
          ) : trustLevel < 3 ? (
            <Button asChild variant="outline" size="sm" className="mt-3 inline-flex gap-1">
              <Link href="/verification">
                Increase Trust Level
                <ArrowRight className="h-3 w-3" />
              </Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Stats Grid — all cards are now clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/dashboard/businesses">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                Businesses{businessCount > 0 ? ` (${businessCount})` : ""}
              </span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/dashboard/metrics">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">Metrics</span>
              <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground" />
            </CardContent>
          </Card>
        </Link>
        <Link href="/billing">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardContent className="flex items-center gap-3 py-4">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
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
