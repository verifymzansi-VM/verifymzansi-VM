"use client";
import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { MultiListingNudge } from "@/components/billing/multi-listing-nudge";
import { usePathname } from "next/navigation";
import { AlertTriangle, Loader2, Sparkles, Check, X, Crown, Camera, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRestoredFoundationBrowserClient as createClient } from "@/lib/foundation/restored-browser-client";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { fetchPostingAllowance } from "@/lib/foundation/posting-allowance-client";
import { restoredPostingPlanInfo, restoredPostingPlans } from "@/lib/foundation/posting-allowance";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("PlanGate");
import {
  PLANS,
  FREE_POST_CONFIG,
  formatPlanPrice,
  formatThirtyDayEquivalent,
  getPlanCheckoutHref,
  type PlanDefinition,
} from "@/lib/constants/pricing";
import { PLAN_SALES_PAUSED_NOTE } from "@/lib/billing/plan-sales";
import { PLAN_TIER_LABELS, type MarketplaceArea, type PlanTier } from "@/types/enums";
import { trialAvailabilityMessage, type IntroTrialOffer } from "@/lib/billing/free-posts";

const FREE_POST_COUNT = Number(FREE_POST_CONFIG.maxAllowed);

interface PlanGateProps {
  onTrialSelected?: (days: 7 | 30) => void;
  area: MarketplaceArea;
  children: ReactNode;
  /** Free events: no trial or plan required (fair use is enforced on the server). */
  freePosting?: boolean;
  /** Tourism & Events: offer the free event path while a plan or trial is still needed. */
  onChooseFreeEvent?: () => void;
}

/** Events never need a plan or trial, so the gate always offers them. */
function FreeEventOption({ onChoose }: { onChoose: () => void }) {
  return (
    <div
      data-testid="free-event-option"
      className="flex flex-col gap-3 rounded-2xl border border-teal-500/30 bg-teal-50 p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-teal-500/10"
    >
      <div>
        <p className="font-semibold">Post an event — Free to post</p>
        <p className="text-sm text-muted-foreground">
          No plan or trial needed. You can advertise free or paid entry.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11 shrink-0 rounded-full"
        onClick={onChoose}
      >
        Create an event
      </Button>
    </div>
  );
}

/** Configured length for a trial choice (7 = short, 30 = launch). */
function trialLength(offer: IntroTrialOffer | undefined, choice: 7 | 30): number {
  return choice === 7 ? (offer?.shortDays ?? 7) : (offer?.longDays ?? 30);
}

interface PlanInfo {
  plans?: PlanDefinition[];
  offer?: IntroTrialOffer;
  tier: PlanTier | "free" | "active";
  isTrial: boolean;
  trialDaysLeft: number;
  freePostAvailable: boolean;
  freePostsUsed: number;
  freePostsRemaining: number;
  postingLimitBypassEnabled: boolean;
  currentCount: number;
  maxAllowed: number;
  creationRemaining?: number;
  maxPhotos: number;
  maxVideos: number;
  videoAllowed: boolean;
}

const AREA_LABELS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "Mzansi Market",
  MZANSI_BUSINESS: "Mzansi Business",
  PROMOTIONS_EVENTS: "Tourism & Events",
};

const AREA_COLORS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "border-0 bg-brand-green-600 text-white hover:bg-brand-green-600",
  MZANSI_BUSINESS: "border-0 bg-brand-blue-600 text-white hover:bg-brand-blue-600",
  PROMOTIONS_EVENTS: "border-0 bg-teal-700 text-white hover:bg-teal-700",
};

const AREA_ITEM_LABELS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "listings",
  MZANSI_BUSINESS: "businesses",
  PROMOTIONS_EVENTS: "events",
};

/* ─────────────────────────────────────────────────────────────
   Inline Plan Grid — compact cards matching the pricing page
   ───────────────────────────────────────────────────────────── */
function planFeatureList(plan: PlanDefinition): { text: string; enabled: boolean }[] {
  const f = plan.features;
  return [
    { text: "1 active posting slot, reusable once its post is deleted", enabled: true },
    { text: `${f.maxPhotos} photos and ${f.maxVideos ?? 1} video per post`, enabled: true },
    { text: "Optional Urgent label add-on", enabled: f.urgentAllowed },
    { text: "No automatic renewal", enabled: true },
  ];
}

function InlinePlanGrid({
  plans,
  onSubscribe,
  subscribing,
}: {
  plans: PlanDefinition[];
  onSubscribe: (plan: PlanDefinition) => void;
  subscribing: string | null;
}) {
  // No plan on sale (paid slots paused): say so instead of an empty grid.
  if (plans.length === 0)
    return (
      <p className="mx-auto max-w-4xl rounded-2xl border border-border/70 bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        {PLAN_SALES_PAUSED_NOTE}
      </p>
    );
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 ${
        plans.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
      } gap-3 max-w-4xl mx-auto`}
    >
      {plans.map((plan) => {
        const isPopular = plan.tier === "quarter";
        const isPremium = plan.tier === "half_year";
        const features = planFeatureList(plan);
        return (
          <Card
            key={`${plan.area}-${plan.tier}`}
            className={`relative rounded-2xl ${
              isPopular
                ? "border-brand-green-600/70 ring-4 ring-brand-green/10 elev-md dark:border-brand-green-500/70"
                : isPremium
                  ? "border-brand-gold/60"
                  : "border-border/70"
            }`}
          >
            {isPopular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="gap-1 whitespace-nowrap border-0 bg-brand-green-600 px-2.5 py-0.5 text-xs font-bold text-white hover:bg-brand-green-600 dark:bg-brand-green-500 dark:text-brand-green-950">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {plan.promoLabel ?? "Popular"}
                </Badge>
              </div>
            )}
            {isPremium && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="gap-1 whitespace-nowrap border-0 bg-brand-gold px-2.5 py-0.5 text-xs font-bold text-brand-gold-950 hover:bg-brand-gold">
                  <Crown className="h-3 w-3" aria-hidden="true" />
                  Best value
                </Badge>
              </div>
            )}

            <CardContent className="p-4 pt-5 space-y-3">
              {/* Plan name + price */}
              <div className="text-center">
                <h3 className="font-body text-base font-semibold text-foreground">
                  {PLAN_TIER_LABELS[plan.tier]}
                </h3>
                <div className="mt-0.5">
                  <span className="font-display text-2xl font-bold">
                    {formatPlanPrice(plan.priceCents)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatThirtyDayEquivalent(plan.priceCents, plan.durationDays)
                    ? `${formatThirtyDayEquivalent(plan.priceCents, plan.durationDays)} per 30 days`
                    : `${plan.durationDays} days`}
                </p>
              </div>

              {/* Feature list */}
              <ul className="space-y-1.5 text-sm">
                {features.map((feat) => (
                  <li key={feat.text} className="flex items-center gap-1.5">
                    {feat.enabled ? (
                      <Check
                        aria-hidden="true"
                        className="h-4 w-4 flex-shrink-0 text-brand-green-700 dark:text-brand-gold-300"
                      />
                    ) : (
                      <X
                        aria-hidden="true"
                        className="h-4 w-4 flex-shrink-0 text-muted-foreground/60"
                      />
                    )}
                    <span className={feat.enabled ? "text-foreground/85" : "text-muted-foreground"}>
                      {feat.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Subscribe button */}
              <Button
                className="h-11 w-full gap-1.5 rounded-full text-sm"
                variant={isPopular ? "trust-verified" : "outline"}
                disabled={subscribing !== null}
                onClick={() => onSubscribe(plan)}
              >
                {subscribing === `${plan.area}-${plan.tier}` ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Processing…
                  </>
                ) : (
                  `Choose ${PLAN_TIER_LABELS[plan.tier]}`
                )}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   PlanGate — main component
   ───────────────────────────────────────────────────────────── */
export function PlanGate({
  area,
  children,
  onTrialSelected,
  freePosting = false,
  onChooseFreeEvent,
}: PlanGateProps) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  useEffect(() => {
    if (isPlaywrightTestMode()) {
      queueMicrotask(() => {
        setPlanInfo({
          tier: "free",
          isTrial: true,
          trialDaysLeft: FREE_POST_CONFIG.durationDays,
          freePostAvailable: true,
          freePostsUsed: 0,
          freePostsRemaining: FREE_POST_COUNT,
          postingLimitBypassEnabled: true,
          currentCount: 0,
          maxAllowed: -1,
          maxPhotos: FREE_POST_CONFIG.maxPhotos,
          maxVideos: FREE_POST_CONFIG.maxVideos,
          videoAllowed: FREE_POST_CONFIG.videoAllowed,
        });
        setLoading(false);
      });
      return;
    }

    let cancelled = false;
    let readGeneration = 0;

    async function checkEntitlements() {
      const generation = ++readGeneration;
      try {
        const facts = await fetchPostingAllowance(area);
        if (cancelled || generation !== readGeneration) return;
        if (!facts.profile_exists) {
          setError("no_profile");
          return;
        }
        setError(null);
        setPlanInfo({
          ...restoredPostingPlanInfo(facts),
          plans: restoredPostingPlans(facts.catalogue, area),
        });
      } catch (error) {
        if (!cancelled && generation === readGeneration)
          setError(
            error instanceof Error && error.message === "not_authenticated"
              ? "not_authenticated"
              : "failed"
          );
      } finally {
        if (!cancelled && generation === readGeneration) setLoading(false);
      }
    }

    queueMicrotask(() => {
      void checkEntitlements();
    });

    // Re-check when tab becomes visible (handles cross-tab free post consumption)
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void checkEntitlements();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    let authAccount: string | null | undefined;
    const authChanges = createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (authAccount === next) return;
      authAccount = next;
      ++readGeneration;
      queueMicrotask(() => {
        if (!cancelled) {
          setLoading(true);
          void checkEntitlements();
        }
      });
    }).data.subscription;
    return () => {
      cancelled = true;
      authChanges.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [area]);

  // Handle subscribe — redirect to checkout
  // Checkout confirms price, dates, slots and renewal before payment.
  function handleSubscribe(plan: PlanDefinition) {
    setSubscribing(`${plan.area}-${plan.tier}`);
    window.location.assign(getPlanCheckoutHref(plan));
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center space-y-3">
          <Loader2
            aria-hidden="true"
            className="mx-auto h-8 w-8 animate-spin text-brand-green-600 dark:text-brand-gold-300"
          />
          <p role="status" className="text-sm text-muted-foreground">
            Checking your plan…
          </p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (error === "not_authenticated") {
    return (
      <Card className="rounded-3xl border-border/70">
        <CardContent className="space-y-3 p-6 text-center sm:p-8">
          <span className="empty-state-icon">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="font-display text-xl font-bold">Sign in to post</h2>
          <p className="mx-auto max-w-md text-muted-foreground">
            Sign in to choose a plan or use your free post on VerifyMzansi. New here? Joining is
            free.
          </p>
          <div className="flex flex-col justify-center gap-2 sm:flex-row">
            <Button asChild variant="trust-verified" className="h-11 rounded-full px-6">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-full px-6">
              <Link href="/register">Create a free account</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No account profile
  if (error === "no_profile") {
    return (
      <Card className="rounded-3xl border-border/70">
        <CardContent className="space-y-3 p-6 text-center sm:p-8">
          <span className="empty-state-icon">
            <ShieldCheck className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="font-display text-xl font-bold">Add your phone number</h2>
          <p className="mx-auto max-w-md text-muted-foreground">
            Add your phone number before posting so buyers can trust your account and you receive
            updates.
          </p>
          <Button asChild variant="trust-verified" className="h-11 rounded-full px-6">
            <Link href={`/dashboard/complete-profile?returnUrl=${encodeURIComponent(pathname)}`}>
              Add phone number
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Generic error
  if (error) {
    return (
      <Card className="rounded-3xl border-destructive/40">
        <CardContent className="space-y-3 p-6 text-center sm:p-8">
          <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
          <h2 className="font-display text-xl font-bold">We couldn&apos;t load your plan</h2>
          <p className="text-muted-foreground">
            This is usually a brief connection problem. Refresh the page to try again.
          </p>
          <Button
            variant="outline"
            className="h-11 rounded-full px-6"
            onClick={() => window.location.reload()}
          >
            Refresh page
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!planInfo) return null;

  // Events are free until they end: never block the form behind a plan.
  if (freePosting) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-teal-500/25 bg-teal-500/5 px-4 py-3 text-sm text-foreground/90">
          <Badge className={AREA_COLORS[area]}>Events</Badge>
          <span>
            Events are <strong>free</strong> and stay visible until the event ends. They do not use
            your trial or a paid slot.
          </span>
        </div>
        {children}
      </div>
    );
  }

  // Get plans for this area
  const areaPlans = planInfo.plans ?? PLANS.filter((p) => p.area === area);

  // ── No plan and trial expired → must subscribe ──
  if (planInfo.tier === "free" && !planInfo.isTrial) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-brand-green/25 bg-brand-green/[0.06] p-4 dark:bg-brand-green/10">
          <h2 className="font-display text-lg font-bold text-foreground">
            Choose your plan to start posting
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Your free post is used or awaiting review.
          </p>
        </div>

        {onChooseFreeEvent ? <FreeEventOption onChoose={onChooseFreeEvent} /> : null}

        <InlinePlanGrid plans={areaPlans} onSubscribe={handleSubscribe} subscribing={subscribing} />

        <MultiListingNudge />

        <p className="text-center text-xs text-muted-foreground">
          One reusable posting slot per plan, with no automatic renewal.{" "}
          <Link
            href="/billing"
            className="rounded-sm font-medium text-brand-green-700 underline dark:text-brand-gold-300"
          >
            View full plan details
          </Link>
        </p>
      </div>
    );
  }

  // ── At listing limit → inline upgrade picker ──
  const isUnlimited = planInfo.maxAllowed === -1;
  const periodLimitReached =
    planInfo.creationRemaining === 0 && planInfo.currentCount < planInfo.maxAllowed;
  if (!isUnlimited && (planInfo.currentCount >= planInfo.maxAllowed || periodLimitReached)) {
    // Slots stack: any retail plan adds one more active posting slot.
    const upgradePlans = areaPlans;

    return (
      <div className="space-y-6">
        <Card className="rounded-2xl border-brand-gold/40 bg-brand-gold/10 dark:bg-brand-gold/[0.07]">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle
                aria-hidden="true"
                className="h-7 w-7 flex-shrink-0 text-brand-gold-700 dark:text-brand-gold-300"
              />
              <div>
                <h2 className="font-display text-lg font-bold">
                  {periodLimitReached ? "New post allowance used" : "All posting slots in use"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {periodLimitReached ? (
                    "A slot is free, but your current plan has reached its limit for new posts. Choose another plan below or wait for the allowance to renew, if your plan allows it."
                  ) : (
                    <>
                      You&apos;ve used{" "}
                      <strong>
                        {planInfo.currentCount}/{planInfo.maxAllowed}
                      </strong>{" "}
                      {AREA_ITEM_LABELS[area]} on your{" "}
                      <Badge variant="outline" className="mx-1 text-xs">
                        {planInfo.isTrial
                          ? "Free post"
                          : (PLAN_TIER_LABELS[planInfo.tier as PlanTier] ?? "current")}
                      </Badge>{" "}
                      plan.{" "}
                      {upgradePlans.length > 0
                        ? "Mark a sold item, deactivate a post from your dashboard, or add another slot below."
                        : "Mark a sold item or deactivate a post from your dashboard."}
                    </>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {onChooseFreeEvent ? <FreeEventOption onChoose={onChooseFreeEvent} /> : null}

        <MultiListingNudge emphasis="strong" />

        <InlinePlanGrid
          plans={upgradePlans}
          onSubscribe={handleSubscribe}
          subscribing={subscribing}
        />
      </div>
    );
  }

  // ── Trial user or no paid plan → show plan picker FIRST, with Continue Trial option ──
  if (planInfo.isTrial || planInfo.tier === "free") {
    return (
      <PlanPickerWithTrial
        onTrialSelected={onTrialSelected}
        onChooseFreeEvent={onChooseFreeEvent}
        area={area}
        planInfo={planInfo}
        areaPlans={areaPlans}
        onSubscribe={handleSubscribe}
        subscribing={subscribing}
      >
        {children}
      </PlanPickerWithTrial>
    );
  }

  // ── Has paid plan — show plan status bar + form directly ──
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-muted/50 px-4 py-3">
        <Badge className={AREA_COLORS[area]}>{AREA_LABELS[area]}</Badge>

        <Badge variant="outline">
          {PLAN_TIER_LABELS[planInfo.tier as PlanTier] ?? "Active"} plan
        </Badge>

        <div className="flex items-center gap-3 text-sm text-muted-foreground ml-auto">
          <span className="flex items-center gap-1">
            <Camera className="h-3.5 w-3.5" />
            {planInfo.maxPhotos} photos
          </span>
          {planInfo.videoAllowed && (
            <span className="flex items-center gap-1 text-brand-green-700 dark:text-brand-gold-300">
              <Video className="h-3.5 w-3.5" aria-hidden="true" />
              Video
            </span>
          )}
          <span>
            {isUnlimited ? (
              "Unlimited posts"
            ) : (
              <>
                {planInfo.currentCount}/{planInfo.maxAllowed} {AREA_ITEM_LABELS[area]} used
              </>
            )}
          </span>
        </div>
      </div>

      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   PlanPickerWithTrial — shows plan cards + Continue with Trial
   ───────────────────────────────────────────────────────────── */
function PlanPickerWithTrial({
  onTrialSelected,
  onChooseFreeEvent,
  area,
  planInfo,
  areaPlans,
  onSubscribe,
  subscribing,
  children,
}: {
  onTrialSelected?: (days: 7 | 30) => void;
  onChooseFreeEvent?: () => void;
  area: MarketplaceArea;
  planInfo: PlanInfo;
  areaPlans: PlanDefinition[];
  onSubscribe: (plan: PlanDefinition) => void;
  subscribing: string | null;
  children: ReactNode;
}) {
  const [showForm, setShowForm] = useState(false);
  const [trialDays, setTrialDays] = useState<7 | 30>(7);
  const selectTrial = (days: 7 | 30) => {
    setTrialDays(days);
    onTrialSelected?.(days);
    setShowForm(true);
  };
  const usageText =
    planInfo.maxAllowed === -1
      ? "Unlimited posts"
      : `${planInfo.currentCount}/${planInfo.maxAllowed} ${AREA_ITEM_LABELS[area]} used`;

  if (showForm) {
    return (
      <div className="space-y-4">
        {/* Free post status bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border/70 bg-muted/50 px-4 py-3">
          <Badge className={AREA_COLORS[area]}>{AREA_LABELS[area]}</Badge>

          <div className="flex items-center gap-1.5 text-sm">
            <Sparkles
              aria-hidden="true"
              className="h-3.5 w-3.5 text-brand-gold-700 dark:text-brand-gold-300"
            />
            <span className="font-medium text-brand-gold-800 dark:text-brand-gold-200">
              {planInfo.postingLimitBypassEnabled
                ? `Staff / testing access — Unlimited posts • ${FREE_POST_CONFIG.maxPhotos} photos • ${FREE_POST_CONFIG.maxVideos} video`
                : `${(planInfo.offer?.adminFreePostsRemaining ?? 0) > 0 ? "Account free post" : "Introductory trial"} — ${(planInfo.offer?.adminFreePostsRemaining ?? 0) > 0 ? 30 : trialLength(planInfo.offer, trialDays)} days • ${FREE_POST_CONFIG.maxPhotos} photos • ${FREE_POST_CONFIG.maxVideos} video`}
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm text-muted-foreground ml-auto">
            <span className="flex items-center gap-1">
              <Camera className="h-3.5 w-3.5" />
              {planInfo.maxPhotos} photos
            </span>
            <span className="flex items-center gap-1 text-brand-green-700 dark:text-brand-gold-300">
              <Video className="h-3.5 w-3.5" aria-hidden="true" />1 video
            </span>
            <span>{usageText}</span>
          </div>
        </div>

        {children}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header + Free Post Combined */}
      {planInfo.isTrial ? (
        <div className="rounded-2xl border border-brand-green/25 bg-brand-green/[0.06] p-4 dark:bg-brand-green/10 sm:p-5">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg font-bold text-foreground">
                  Choose how you want to post
                </h2>
                <Badge className="border-0 bg-brand-gold/20 text-xs font-semibold text-brand-gold-800 hover:bg-brand-gold/20 dark:text-brand-gold-200">
                  {planInfo.postingLimitBypassEnabled ? "Testing mode" : "Free trial"}
                </Badge>
              </div>
              <p className="text-sm font-medium text-foreground/85">
                {planInfo.postingLimitBypassEnabled
                  ? `Posting limits bypassed: ${FREE_POST_CONFIG.maxPhotos} photos and ${FREE_POST_CONFIG.maxVideos} video`
                  : (planInfo.offer?.adminFreePostsRemaining ?? 0) > 0
                    ? `${planInfo.offer?.adminFreePostsRemaining} extra free posts remaining across all categories`
                    : "One introductory post across all three areas"}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {planInfo.postingLimitBypassEnabled
                  ? `Each post still uses free-tier media limits: ${FREE_POST_CONFIG.maxPhotos} photos and ${FREE_POST_CONFIG.maxVideos} video.`
                  : (planInfo.offer?.adminFreePostsRemaining ?? 0) > 0
                    ? "Each lasts 30 days from approval."
                    : planInfo.offer?.thirtyDayAvailable
                      ? `Choose ${trialLength(planInfo.offer, 7)} or ${trialLength(planInfo.offer, 30)} days, once. Starts on approval; standard placement.`
                      : `${trialLength(planInfo.offer, 7)} days, once. Starts on approval; standard placement.`}
              </p>
            </div>
            <Button
              variant="trust-verified"
              className="h-11 w-full whitespace-nowrap rounded-full px-6 sm:w-auto"
              disabled={
                !planInfo.postingLimitBypassEnabled &&
                !((planInfo.offer?.adminFreePostsRemaining ?? 0) > 0
                  ? planInfo.offer?.thirtyDayAvailable
                  : planInfo.offer?.sevenDayAvailable)
              }
              onClick={() =>
                selectTrial((planInfo.offer?.adminFreePostsRemaining ?? 0) > 0 ? 30 : 7)
              }
            >
              {planInfo.postingLimitBypassEnabled
                ? "Start posting"
                : (planInfo.offer?.adminFreePostsRemaining ?? 0) > 0
                  ? "Use 30-day free post"
                  : `Choose ${trialLength(planInfo.offer, 7)} days free`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-brand-green/25 bg-brand-green/[0.06] p-4 dark:bg-brand-green/10">
          <h2 className="font-display text-lg font-bold text-foreground">
            Choose how you want to post
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {areaPlans.length > 0
              ? areaPlans
                  .map((plan) => `${formatPlanPrice(plan.priceCents)} / ${plan.durationDays} days`)
                  .join(", ")
              : PLAN_SALES_PAUSED_NOTE}
          </p>
        </div>
      )}

      {planInfo.offer &&
        planInfo.offer.thirtyDayAvailable &&
        planInfo.isTrial &&
        !planInfo.postingLimitBypassEnabled &&
        !(planInfo.offer.adminFreePostsRemaining ?? 0) && (
          <div className="space-y-2 rounded-2xl border border-border/70 bg-card p-4">
            <p className="font-semibold text-foreground">
              {trialLength(planInfo.offer, 30)}-day free launch trial
            </p>
            <p className="text-sm text-muted-foreground">
              {trialAvailabilityMessage(planInfo.offer)}
            </p>
            <Button
              variant="outline"
              className="h-11 rounded-full px-5"
              disabled={!planInfo.offer.thirtyDayAvailable}
              onClick={() => selectTrial(30)}
            >
              Choose {trialLength(planInfo.offer, 30)} days free
            </Button>
            <p className="text-xs text-muted-foreground">
              If spaces fill before approval, you can choose {trialLength(planInfo.offer, 7)} days
              instead.
            </p>
          </div>
        )}
      {onChooseFreeEvent ? <FreeEventOption onChoose={onChooseFreeEvent} /> : null}

      {/* Paid plans */}
      <div className="space-y-2">
        <h3 className="pt-2 font-display text-base font-bold text-foreground">
          Or choose a paid plan
        </h3>
        <InlinePlanGrid plans={areaPlans} onSubscribe={onSubscribe} subscribing={subscribing} />
      </div>

      <MultiListingNudge />

      <p className="text-center text-xs text-muted-foreground">
        Paid once, no automatic renewal.{" "}
        <Link
          href="/billing"
          className="rounded-sm font-medium text-brand-green-700 underline dark:text-brand-gold-300"
        >
          View full plan details
        </Link>
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Shared entitlement fetch for the media-limit hooks.
   ───────────────────────────────────────────────────────────── */
interface PlanEntitlementInfo {
  maxPhotos: number;
  maxVideos: number;
  videoAllowed: boolean;
}

function fetchSharedEntitlements(area: MarketplaceArea): Promise<PlanEntitlementInfo> {
  return fetchPostingAllowance(area).then((facts) => ({
    maxPhotos: facts.max_photos,
    maxVideos: facts.max_videos,
    videoAllowed: facts.max_videos > 0,
  }));
}

function usePlanEntitlements(area: MarketplaceArea): PlanEntitlementInfo {
  const [info, setInfo] = useState<PlanEntitlementInfo>(() => ({
    maxPhotos: FREE_POST_CONFIG.maxPhotos,
    maxVideos: isPlaywrightTestMode() ? FREE_POST_CONFIG.maxVideos : FREE_POST_CONFIG.maxVideos,
    videoAllowed: FREE_POST_CONFIG.videoAllowed,
  }));

  useEffect(() => {
    if (isPlaywrightTestMode()) return;
    let cancelled = false;
    fetchSharedEntitlements(area)
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch((error) => {
        logger.warn("Unable to load posting entitlements for media controls", {
          area,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) {
          setInfo({ maxPhotos: 0, maxVideos: 0, videoAllowed: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [area]);

  return info;
}

/* ─────────────────────────────────────────────────────────────
   Hook: usePlanMaxPhotos
   ───────────────────────────────────────────────────────────── */
export function usePlanMaxPhotos(area: MarketplaceArea): number {
  return usePlanEntitlements(area).maxPhotos;
}

/* ─────────────────────────────────────────────────────────────
   Hook: usePlanVideoAllowed
   ───────────────────────────────────────────────────────────── */
export function usePlanVideoAllowed(area: MarketplaceArea): boolean {
  return usePlanEntitlements(area).videoAllowed;
}

/* ─────────────────────────────────────────────────────────────
   Hook: usePlanMaxVideos
   ───────────────────────────────────────────────────────────── */
export function usePlanMaxVideos(area: MarketplaceArea): number {
  return usePlanEntitlements(area).maxVideos;
}
