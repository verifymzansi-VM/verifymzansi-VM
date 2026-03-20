import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ShoppingBag,
  MessageSquare,
  ShieldCheck,
  Plus,
  Megaphone,
  Building2,
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
import { NeedsAttention } from "@/components/dashboard/needs-attention";
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

interface DashboardSummaryCardProps {
  title: string;
  value: number;
  description: string;
  href: string;
  icon: React.ElementType;
  toneClassName: string;
}

function DashboardSummaryCard({
  title,
  value,
  description,
  href,
  icon: Icon,
  toneClassName,
}: DashboardSummaryCardProps) {
  return (
    <Link href={href} className="group block h-full">
      <Card className="h-full border-border/70 transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div
              className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${toneClassName}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
              Open
            </span>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="font-display text-3xl font-bold tracking-tight">{value}</p>
          </div>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function getVerificationCopy(status: string, stepsRemaining: number) {
  if (status === "verified") {
    return {
      title: "Your account is verified",
      description: "Your identity checks are complete and your trust badge is live.",
      ctaLabel: "Manage verification",
    };
  }

  if (status === "pending_review") {
    return {
      title: "Verification is under review",
      description:
        "Our team is checking your documents. You can follow progress from the verification page.",
      ctaLabel: "View status",
    };
  }

  if (status === "rejected") {
    return {
      title: "Verification needs changes",
      description: "Review the failed checks and resubmit the missing or incorrect information.",
      ctaLabel: "Fix verification",
    };
  }

  return {
    title: "Complete your verification",
    description: `${stepsRemaining} step${stepsRemaining === 1 ? "" : "s"} remaining to unlock full trust signals across the platform.`,
    ctaLabel: "Continue verification",
  };
}

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
        .limit(5),
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
  const unreadLeadCount = unreadLeadsResult.count || 0;
  const totalLeadCount = totalLeadsResult.count || 0;
  const activePromos = activePromosResult.count;
  const rejectedListingCount = rejectedListingsResult.count || 0;
  const pendingModerationCount = pendingModerationResult.count || 0;
  const expiringListingCount = expiringListingsResult.count || 0;
  const expiringPromoCount = expiringPromosResult.count || 0;
  const businessCount = businessCountResult.count || 0;

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
  const recentPosts: RecentPost[] = (ownerListings ?? []).map(
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
    MZANSI_MARKET: "Listings",
    MZANSI_BUSINESS: "Businesses",
    PROMOTIONS_EVENTS: "Promotions",
  };
  const AREA_COUNTS: Record<string, number> = {
    MZANSI_MARKET: activeListings || 0,
    MZANSI_BUSINESS: businessCount,
    PROMOTIONS_EVENTS: activePromos || 0,
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
      currentCount: AREA_COUNTS[ent.area] ?? 0,
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
  const verificationCopy = getVerificationCopy(
    verificationSummary.accountVerificationStatus,
    verificationSummary.stepsRemaining
  );
  const overviewCards: DashboardSummaryCardProps[] = [
    {
      title: "Listings",
      value: activeListings || 0,
      description:
        rejectedListingCount > 0
          ? `${rejectedListingCount} need edits before they can go live.`
          : pendingModerationCount > 0
            ? `${pendingModerationCount} currently under review.`
            : expiringListingCount > 0
              ? `${expiringListingCount} expiring in the next 7 days.`
              : "Manage your live, draft, and archived listings.",
      href: "/dashboard/listings",
      icon: ShoppingBag,
      toneClassName:
        "bg-brand-green-50 text-brand-green dark:bg-brand-green-950 dark:text-brand-green-100",
    },
    {
      title: "Leads",
      value: unreadLeadCount,
      description:
        totalLeadCount > 0
          ? `${totalLeadCount} total enquiries received across your account.`
          : "New buyer messages and contact requests appear here.",
      href: "/dashboard/leads",
      icon: MessageSquare,
      toneClassName: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-100",
    },
    {
      title: "Businesses",
      value: businessCount,
      description:
        businessCount > 0
          ? "Keep your business details, category, and visibility current."
          : "Add a business profile so buyers can discover your brand.",
      href: "/dashboard/businesses",
      icon: Building2,
      toneClassName: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-100",
    },
    {
      title: "Promotions",
      value: activePromos || 0,
      description:
        expiringPromoCount > 0
          ? `${expiringPromoCount} ending soon and ready for renewal.`
          : activePromos > 0
            ? "Track the visibility boosts currently running on your listings."
            : "Boost listings when you need extra reach or urgency.",
      href: "/dashboard/promotions",
      icon: Megaphone,
      toneClassName: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-100",
    },
  ];

  return (
    <div className="space-y-6">
      <EmailConfirmedToast />
      <PageHeader
        title={`Welcome back, ${displayName}`}
        description="Keep your listings, leads, businesses, and promotions organised in one place."
        breadcrumbs={[{ label: "Dashboard" }]}
      >
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <NeedsAttention
            unreadLeadCount={unreadLeadCount}
            rejectedListingCount={rejectedListingCount}
            pendingModerationCount={pendingModerationCount}
            expiringListingCount={expiringListingCount}
            expiringPromoCount={expiringPromoCount}
            verificationStatus={verificationSummary.accountVerificationStatus}
            stepsRemaining={verificationSummary.stepsRemaining}
          />

          <section className="space-y-3" aria-labelledby="workspace-overview-heading">
            <div className="space-y-1">
              <h2 id="workspace-overview-heading" className="font-display text-lg font-semibold">
                Workspace overview
              </h2>
              <p className="text-sm text-muted-foreground">
                Jump straight into the areas you manage most often.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {overviewCards.map((card) => (
                <DashboardSummaryCard key={card.title} {...card} />
              ))}
            </div>
          </section>

          {isNewUser ? (
            <DashboardOnboarding
              isVerified={trustLevel >= 3}
              hasListings={(activeListings || 0) > 0}
              hasBusinesses={businessCount > 0}
            />
          ) : (
            <MyRecentPosts posts={recentPosts} />
          )}

          <RecentActivity items={recentActivity} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base font-display">
                    <ShieldCheck className="h-5 w-5 text-brand-green" />
                    Account status
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{verificationCopy.description}</p>
                </div>
                <TrustBadge level={trustLevel} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{verificationCopy.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Trust level {trustLevel} on your account.
                    </p>
                  </div>
                  {trustLevel >= 3 && (
                    <Badge className="gap-1 bg-brand-green-50 text-brand-green border-brand-green-200 dark:bg-brand-green-950 dark:border-brand-green-800">
                      <BadgeCheck className="h-3 w-3" />
                      Verified
                    </Badge>
                  )}
                </div>
              </div>

              {trustLevel < 3 && <VerificationProgress steps={verificationProgressSteps} />}

              <Button
                asChild
                variant={trustLevel >= 3 ? "outline" : "default"}
                className="w-full sm:w-auto"
              >
                <Link href="/verification">{verificationCopy.ctaLabel}</Link>
              </Button>
            </CardContent>
          </Card>

          {planInfos.length > 0 && <PlanSummary plans={planInfos} />}
        </div>
      </div>
    </div>
  );
}
