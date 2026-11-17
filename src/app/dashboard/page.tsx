import { getVerificationLevel, VERIFICATION_LEVEL_LABELS } from "@/lib/account/verification-level";
import { IntroductoryTrialCard } from "@/components/dashboard/introductory-trial-card";
import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  BRAND_SHIELD_LARGE_SRC,
  BrandSurface,
  brandOutlineButtonClassName,
} from "@/components/brand";
import { LayoutList, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerifiedTick } from "@/components/trust/verified-tick";
import { summarizeVerification } from "@/lib/account/verification-summary";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { EmailConfirmedToast } from "@/components/dashboard/email-confirmed-toast";
import { DashboardOnboarding } from "@/components/dashboard/dashboard-onboarding";
import {
  ListingManagerMini,
  type MiniListingPost,
} from "@/components/dashboard/listing-manager-mini";
import { QuickLinks } from "@/components/dashboard/quick-links";
import { DashboardLiveLeadAlerts } from "@/components/dashboard/dashboard-live-lead-alerts";
import { RecentLeads, type RecentLead } from "@/components/dashboard/recent-leads";
import { VerificationStatusCard } from "@/components/dashboard/verification-status-card";
import { SuspensionNotice } from "@/components/dashboard/suspension-notice";
import { readSelfReviewSession } from "@/lib/foundation/self-review-session";
import { readFoundationServerUser } from "@/lib/foundation/server-session";
import {
  readRestoredOwnerDashboard,
  restoredDashboardResults,
} from "@/lib/foundation/owner-dashboard-server";

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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ suspended?: string | string[] }>;
}) {
  if ((await searchParams).suspended === "true") {
    const restriction = await readSelfReviewSession();
    if (!restriction) redirect("/error?reason=forbidden");
    if (restriction.status === "banned") redirect("/banned");
    if (restriction.status === "suspended" && restriction.ends_at)
      return <SuspensionNotice confirmedUntil={restriction.ends_at} />;
  }
  // The account the sign-in gate already verified for this request.
  const user = await readFoundationServerUser();

  if (!user) redirect("/login");

  const foundationDashboard = await readRestoredOwnerDashboard(user.id);

  const results = restoredDashboardResults(foundationDashboard);

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
  // Live businesses without a CIPC or Seen sticker (none from the new backend).
  const unstickered = (
    (settled(results[15], EMPTY_LIST_OK).data ?? []) as Array<{ id: string }>
  ).map((row) => row.id);
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
  const posts: MiniListingPost[] = listingRows.map(
    (l: {
      id: string;
      title: string | null;
      status: string;
      area?: string | null;
      photos?: string[] | null;
      view_count?: number | null;
      expires_at?: string | null;
      deletes_at?: string | null;
      created_at: string;
      updated_at?: string | null;
    }) => ({
      id: l.id,
      title: l.title,
      status: l.status,
      area: l.area,
      photos: l.photos,
      view_count: l.view_count ?? null,
      expires_at: l.expires_at,
      deletes_at: l.deletes_at ?? null,
      created_at: l.created_at,
      updated_at: l.updated_at,
    })
  );

  // Plan tier label for quick links
  const planLabel = foundationDashboard.snapshot.paid_plans[0]?.label ?? undefined;

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

  // Recent leads with the titles of the posts they are about
  const recentLeadRows = (
    (settled(results[14], EMPTY_LIST_OK).data ?? []) as Array<
      Omit<RecentLead, "title"> & { target_id: string }
    >
  ).slice(0, 3);
  const leadTitles = new Map<string, string>();
  for (const row of foundationDashboard.snapshot.recent_leads) {
    if (row.title) leadTitles.set(`${row.target_type}:${row.target_id}`, row.title);
  }
  const recentLeads: RecentLead[] = recentLeadRows.map((row) => ({
    ...row,
    title: leadTitles.get(`${row.target_type}:${row.target_id}`) ?? null,
  }));

  return (
    <div className="space-y-6">
      <EmailConfirmedToast />

      {/* ───── Greeting + primary actions ───── */}
      <BrandSurface
        as="header"
        className="flex flex-col gap-5 rounded-3xl px-5 pb-7 pt-6 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:pb-9 sm:pt-8"
      >
        <Image
          src={BRAND_SHIELD_LARGE_SRC}
          alt=""
          aria-hidden="true"
          width={160}
          height={160}
          unoptimized
          className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 object-contain opacity-[0.12] sm:right-6 sm:top-1/2 sm:-translate-y-1/2 sm:opacity-20"
        />
        <div className="relative min-w-0">
          <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight text-white sm:text-[2.25rem]">
            Hi, <span className="gold-shine text-brand-gold-300">{firstName}</span>
          </h1>
          {isVerified ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1.5 pr-2.5 font-semibold text-white ring-1 ring-inset ring-white/15">
                <VerifiedTick decorative className="h-4 w-4" />
                <span>{VERIFICATION_LEVEL_LABELS[verificationLevel]}</span>
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-white/70">Welcome to your dashboard.</p>
          )}
        </div>

        <div className="relative grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:pr-40">
          <Button
            asChild
            className="h-11 gap-1.5 rounded-full bg-brand-gold-300 px-5 font-semibold text-brand-gold-950 hover:bg-brand-gold-200"
          >
            <Link href="/post/create">
              <Plus aria-hidden="true" className="h-4 w-4" />
              New post
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className={cn("h-11 gap-1.5 rounded-full px-5", brandOutlineButtonClassName)}
          >
            <Link href="/dashboard/listings">
              <LayoutList aria-hidden="true" className="h-4 w-4 text-brand-gold-300" />
              My posts
            </Link>
          </Button>
        </div>
      </BrandSurface>

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
        unstickeredBusinessCount={isVerified ? unstickered.length : 0}
        unstickeredBusinessHref={
          unstickered.length === 1
            ? `/dashboard/businesses/${unstickered[0]}/verification`
            : "/dashboard/listings?area=MZANSI_BUSINESS"
        }
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
          <IntroductoryTrialCard foundationClaim={foundationDashboard.introTrial} />
          <QuickLinks planLabel={planLabel} />
        </aside>
      </div>
    </div>
  );
}
