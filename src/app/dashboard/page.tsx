import { getVerificationLevel, VERIFICATION_LEVEL_LABELS } from "@/lib/account/verification-level";
import { PLAN_TIER_LABELS, type PlanTier } from "@/types/enums";
import { IntroductoryTrialCard } from "@/components/dashboard/introductory-trial-card";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerifiedTick } from "@/components/trust/verified-tick";
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
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import { RecentLeads, type RecentLead } from "@/components/dashboard/recent-leads";
import { VerificationStatusCard } from "@/components/dashboard/verification-status-card";

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
  description: "Your VerifyMzansi dashboard: manage posts, leads and businesses in one place.",
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
        .select("id, title, status, area, photos, view_count, expires_at, created_at, updated_at")
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
      applyVisibleExpiryFilter(
        supabase.from("listings").select("*", { count: "exact", head: true }).eq("status", "live"),
        now
      ),
      listingOwnerColumn,
      user.id
    ),
    /* 5 — active promotions count */
    applyOwnerFilter(
      applyVisibleExpiryFilter(
        supabase
          .from("promotions")
          .select("*", { count: "exact", head: true })
          .eq("status", "live")
          .eq("promotion_type", "event")
          .or(`end_date.is.null,end_date.gte.${now}`),
        now
      ),
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
        .or("area.is.null,area.neq.PROMOTIONS_EVENTS"),
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
    /* 13 — organisation administrator (verification representative level) */
    supabase
      .from("organisation_admins")
      .select("organisation_id", { count: "exact", head: true })
      .eq("user_id", user.id),
    /* 14 — latest enquiries for the recent leads card */
    applyOwnerFilter(
      supabase
        .from("leads")
        .select("id, target_id, target_type, message, status, buyer_name, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
      leadsOwnerColumn,
      user.id
    ),
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
      expires_at?: string | null;
      created_at: string;
      updated_at?: string | null;
    }) => ({
      id: l.id,
      title: l.title,
      status: l.status,
      area: l.area,
      photos: l.photos,
      view_count: listingViewCounts.data.get(l.id) ?? l.view_count ?? null,
      expires_at: l.expires_at,
      created_at: l.created_at,
      updated_at: l.updated_at,
    })
  );

  // Plan tier label for quick links
  const activeEntitlements = entitlementsResult.data ?? [];
  const topTier =
    activeEntitlements.length > 0
      ? activeEntitlements.reduce((best: string, ent: { tier?: string }) => {
          const rank: Record<string, number> = {
            enterprise: 8,
            year: 7,
            half_year: 6,
            month: 5,
            pro: 4,
            growth: 3,
            starter: 2,
            basic: 1,
          };
          const current = rank[ent.tier ?? ""] ?? 0;
          const bestRank = rank[best] ?? 0;
          return current > bestRank ? (ent.tier ?? best) : best;
        }, activeEntitlements[0]?.tier ?? "basic")
      : null;
  const planLabel = topTier
    ? `${PLAN_TIER_LABELS[topTier as PlanTier] ?? topTier} plan`
    : undefined;

  // Verification chip helpers
  const isVerified = trustLevel >= 3;
  const organisationAdminResult = settled(results[13], EMPTY_OK);
  const verificationLevel = getVerificationLevel({
    emailConfirmed: Boolean(user.email_confirmed_at),
    phoneApproved: (verificationSteps ?? []).some(
      (step: { step_type?: string; status?: string }) =>
        step.step_type === "phone" && step.status === "approved"
    ),
    identityVerified: isVerified,
    organisationAdministrator: (organisationAdminResult.count ?? 0) > 0,
  });
  const verStatus = verificationSummary.accountVerificationStatus;
  const stepsRemaining = verificationSummary.stepsRemaining;
  const hasAnyPosts = posts.length > 0;
  const showDashboardOnboarding = !hasAnyPosts && businessCount === 0 && tourismEventsCount === 0;

  // Recent leads — titles resolved in one query per content type
  const recentLeadRows = (
    (settled(results[14], EMPTY_LIST_OK).data ?? []) as Array<
      Omit<RecentLead, "title"> & { target_id: string }
    >
  ).slice(0, 3);
  const leadTitles = new Map<string, string>();
  await Promise.all(
    (["listing", "promotion"] as const).map(async (type) => {
      const ids = [
        ...new Set(
          recentLeadRows.filter((row) => row.target_type === type).map((row) => row.target_id)
        ),
      ];
      if (ids.length === 0) return;
      try {
        const { data } = await supabase
          .from(type === "promotion" ? "promotions" : "listings")
          .select("id, title")
          .in("id", ids);
        for (const item of (data ?? []) as Array<{ id: string; title: string | null }>) {
          if (item.title) leadTitles.set(`${type}:${item.id}`, item.title);
        }
      } catch {
        // Titles are a nicety; the card still works without them.
      }
    })
  );
  const recentLeads: RecentLead[] = recentLeadRows.map((row) => ({
    ...row,
    title: leadTitles.get(`${row.target_type}:${row.target_id}`) ?? null,
  }));

  return (
    <div className="space-y-6">
      <EmailConfirmedToast />

      {/* ───── Greeting + primary actions ───── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight text-foreground sm:text-[2.25rem]">
            Hi, {firstName}
          </h1>
          {isVerified ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-green-50 py-1 pl-1.5 pr-2.5 font-semibold text-brand-green-700 ring-1 ring-inset ring-brand-green/20 dark:bg-brand-green-500/15 dark:text-brand-green-300">
                <VerifiedTick decorative className="h-4 w-4" />
                <span>Verified</span>
              </span>
              <span className="text-muted-foreground">
                {VERIFICATION_LEVEL_LABELS[verificationLevel]}
              </span>
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <Button
            asChild
            variant="trust-verified"
            className="h-11 gap-1.5 rounded-full px-5 font-semibold"
          >
            <Link href="/post/create">
              <Plus aria-hidden="true" className="h-4 w-4" />
              New post
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-11 gap-1.5 rounded-full px-5">
            <Link href="/dashboard/listings">
              <Zap aria-hidden="true" className="h-4 w-4 text-brand-gold-600" />
              Boost a post
            </Link>
          </Button>
        </div>
      </header>

      <VerificationStatusCard
        status={verStatus}
        stepsRemaining={stepsRemaining}
        steps={verificationSteps}
      />

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
        includeVerification={false}
      />

      {/* ───── Main content ───── */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
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
          {showDashboardOnboarding && recentLeads.length === 0 ? null : (
            <RecentLeads leads={recentLeads} hasPosts={hasAnyPosts} />
          )}
        </div>

        <aside aria-label="More for your account" className="min-w-0 space-y-6">
          <IntroductoryTrialCard />
          <QuickLinks planLabel={planLabel} />
        </aside>
      </div>
    </div>
  );
}
