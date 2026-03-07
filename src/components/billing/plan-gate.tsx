"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Sparkles,
  Check,
  X,
  Crown,
  Camera,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { createLogger } from "@/lib/utils/logger";
import { isPostingLimitBypassEnabled } from "../../lib/utils/posting-limit-bypass";

const logger = createLogger("PlanGate");
import {
  PLANS,
  TRIAL_CONFIG,
  FREE_POST_CONFIG,
  type PlanDefinition,
} from "@/lib/constants/pricing";
import { getEntitlements } from "@/lib/services/entitlements";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

interface PlanGateProps {
  area: MarketplaceArea;
  children: ReactNode;
}

interface PlanInfo {
  tier: PlanTier | "free";
  isTrial: boolean;
  trialDaysLeft: number;
  freePostAvailable: boolean;
  postingLimitBypassEnabled: boolean;
  currentCount: number;
  maxAllowed: number;
  maxPhotos: number;
  maxVideos: number;
  videoAllowed: boolean;
}

const AREA_LABELS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "Mzansi Market",
  MALL_SHOPS: "Mall Shops",
  BUSINESS_ADS: "Business Ads",
  MZANSI_BUSINESS: "Mzansi Business",
  PROMOTIONS_EVENTS: "Promotions & Events",
};

const AREA_COLORS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "bg-brand-green text-white",
  MALL_SHOPS: "bg-brand-gold text-amber-950",
  BUSINESS_ADS: "bg-sky-700 text-white",
  MZANSI_BUSINESS: "bg-brand-blue text-white",
  PROMOTIONS_EVENTS: "bg-purple-600 text-white",
};

const AREA_COUNT_TABLES: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "listings",
  MALL_SHOPS: "storefronts",
  BUSINESS_ADS: "business_profiles",
  MZANSI_BUSINESS: "businesses",
  PROMOTIONS_EVENTS: "promotions",
};

const AREA_ITEM_LABELS: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "listings",
  MALL_SHOPS: "storefronts",
  BUSINESS_ADS: "profiles",
  MZANSI_BUSINESS: "businesses",
  PROMOTIONS_EVENTS: "promotions",
};

/* ─────────────────────────────────────────────────────────────
   Plan Comparison Table — horizontal table with plans as columns
   ───────────────────────────────────────────────────────────── */
function PlanComparisonTable({
  plans,
  onSubscribe,
  subscribing,
}: {
  plans: PlanDefinition[];
  onSubscribe: (plan: PlanDefinition) => void;
  subscribing: string | null;
}) {
  const area = plans[0]?.area;
  const itemLabel =
    area === "MALL_SHOPS"
      ? "storefronts"
      : area === "BUSINESS_ADS"
        ? "profiles"
        : area === "MZANSI_BUSINESS"
          ? "businesses"
          : area === "PROMOTIONS_EVENTS"
            ? "promotions"
            : "listings";

  function getMaxItems(plan: PlanDefinition) {
    return (
      plan.features.maxListings ??
      plan.features.maxStorefronts ??
      plan.features.maxProfiles ??
      plan.features.maxBusinesses ??
      plan.features.maxPromotions ??
      0
    );
  }

  const featureRows: {
    label: string;
    getValue: (p: PlanDefinition) => ReactNode;
  }[] = [
    {
      label: `Max ${itemLabel}`,
      getValue: (p) => {
        const v = getMaxItems(p);
        return <span className="font-semibold">{v === -1 ? "Unlimited" : v}</span>;
      },
    },
    {
      label: "Photos per post",
      getValue: (p) => <span className="font-semibold">{p.features.maxPhotos}</span>,
    },
    {
      label: "Video uploads",
      getValue: (p) =>
        p.features.videoAllowed ? (
          <Check className="h-4 w-4 text-brand-green mx-auto" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
        ),
    },
    {
      label: "Boost listings",
      getValue: (p) =>
        p.features.boostAllowed ? (
          <Check className="h-4 w-4 text-brand-green mx-auto" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
        ),
    },
    {
      label: "Featured placement",
      getValue: (p) =>
        p.features.featuredAllowed ? (
          <Check className="h-4 w-4 text-brand-green mx-auto" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
        ),
    },
    {
      label: "Urgent badge",
      getValue: (p) =>
        p.features.urgentAllowed ? (
          <Check className="h-4 w-4 text-brand-green mx-auto" />
        ) : (
          <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />
        ),
    },
  ];

  /* ── Mobile: compact 2-col grid (< md) ── */
  const mobileView = (
    <div className="md:hidden grid grid-cols-2 gap-2">
      {plans.map((plan) => {
        const isPopular = plan.tier === "growth";
        const isPremium = plan.tier === "pro";
        const maxItems = getMaxItems(plan);
        return (
          <div
            key={`${plan.area}-${plan.tier}`}
            className={`relative rounded-lg border p-3 space-y-2 ${
              isPopular
                ? "border-brand-green ring-1 ring-brand-green/20"
                : isPremium
                  ? "border-brand-gold/50"
                  : "border-border"
            }`}
          >
            {isPopular && (
              <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-green text-white text-[10px] gap-0.5 px-1.5 py-0">
                <Sparkles className="h-2.5 w-2.5" /> Best Value
              </Badge>
            )}
            {isPremium && (
              <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-gold text-amber-950 text-[10px] gap-0.5 px-1.5 py-0">
                <Crown className="h-2.5 w-2.5" /> Premium
              </Badge>
            )}
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                {plan.tier}
              </p>
              <p className="font-display text-xl font-bold leading-tight">
                R{plan.priceCents / 100}
              </p>
              <p className="text-[10px] text-muted-foreground">/ 30 days</p>
            </div>
            <div className="text-[11px] space-y-0.5 text-muted-foreground">
              <p>
                {maxItems === -1 ? "Unlimited" : maxItems} {itemLabel}
              </p>
              <p>{plan.features.maxPhotos} photos</p>
              {plan.features.videoAllowed && (
                <p className="text-brand-green flex items-center gap-0.5">
                  <Check className="h-3 w-3" /> Video
                </p>
              )}
              {plan.features.boostAllowed && (
                <p className="flex items-center gap-0.5">
                  <Check className="h-3 w-3" /> Boost
                </p>
              )}
            </div>
            <Button
              size="sm"
              className="w-full text-xs h-7 gap-1"
              variant={isPopular ? "default" : "outline"}
              disabled={subscribing !== null}
              onClick={() => onSubscribe(plan)}
            >
              {subscribing === `${plan.area}-${plan.tier}` ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  Choose <ArrowRight className="h-3 w-3" />
                </>
              )}
            </Button>
          </div>
        );
      })}
    </div>
  );

  /* ── Desktop: comparison table (md+) ── */
  const desktopView = (
    <div className="hidden md:block overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        {/* ── Header: plan names + prices ── */}
        <thead>
          <tr>
            <th className="text-left py-2 pr-4 w-[140px]"> </th>
            {plans.map((plan) => {
              const isPopular = plan.tier === "growth";
              const isPremium = plan.tier === "pro";
              return (
                <th
                  key={`${plan.area}-${plan.tier}`}
                  className={`text-center px-3 pt-1 pb-3 relative ${
                    isPopular ? "bg-brand-green/5 rounded-t-lg" : ""
                  }`}
                >
                  {isPopular && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-green text-white gap-0.5 text-[10px] px-2 py-0">
                      <Sparkles className="h-2.5 w-2.5" /> Best Value
                    </Badge>
                  )}
                  {isPremium && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-brand-gold text-amber-950 gap-0.5 text-[10px] px-2 py-0">
                      <Crown className="h-2.5 w-2.5" /> Premium
                    </Badge>
                  )}
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium mt-1">
                    {plan.tier}
                  </p>
                  <p className="font-display text-2xl font-bold leading-tight">
                    R{plan.priceCents / 100}
                  </p>
                  <p className="text-[11px] text-muted-foreground font-normal">/ 30 days</p>
                </th>
              );
            })}
          </tr>
        </thead>
        {/* ── Feature rows ── */}
        <tbody>
          {featureRows.map((row, i) => (
            <tr key={row.label} className={i % 2 === 0 ? "bg-muted/30" : ""}>
              <td className="py-1.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                {row.label}
              </td>
              {plans.map((plan) => {
                const isPopular = plan.tier === "growth";
                return (
                  <td
                    key={`${plan.area}-${plan.tier}`}
                    className={`text-center py-1.5 px-3 text-xs ${
                      isPopular ? "bg-brand-green/5" : ""
                    }`}
                  >
                    {row.getValue(plan)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {/* ── CTA row ── */}
        <tfoot>
          <tr>
            <td className="pt-3"> </td>
            {plans.map((plan) => {
              const isPopular = plan.tier === "growth";
              return (
                <td
                  key={`${plan.area}-${plan.tier}`}
                  className={`text-center pt-3 px-2 ${
                    isPopular ? "bg-brand-green/5 rounded-b-lg" : ""
                  }`}
                >
                  <Button
                    size="sm"
                    className="w-full gap-1 text-xs"
                    variant={isPopular ? "default" : "outline"}
                    disabled={subscribing !== null}
                    onClick={() => onSubscribe(plan)}
                  >
                    {subscribing === `${plan.area}-${plan.tier}` ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Processing…
                      </>
                    ) : (
                      <>
                        Choose {plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}
                        <ArrowRight className="h-3 w-3" />
                      </>
                    )}
                  </Button>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <>
      {mobileView}
      {desktopView}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   PlanGate — main component
   ───────────────────────────────────────────────────────────── */
export function PlanGate({ area, children }: PlanGateProps) {
  const [loading, setLoading] = useState(true);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  useEffect(() => {
    async function checkEntitlements() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setError("not_authenticated");
          setLoading(false);
          return;
        }

        // Get seller profile — just check it exists
        const { data: profile } = await supabase
          .from("seller_profiles")
          .select("id, created_at")
          .eq("user_id", user.id)
          .single();

        if (!profile) {
          setError("no_profile");
          setLoading(false);
          return;
        }

        // Get active entitlement for this area from the entitlements table
        const { data: entitlement } = await supabase
          .from("entitlements")
          .select("tier, type, status, started_at, expires_at")
          .eq("user_id", user.id)
          .eq("area", area)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const tier = (entitlement?.tier as PlanTier) || null;
        const postingLimitBypassEnabled = isPostingLimitBypassEnabled();

        // Check if the user has already used their one-time free post for this area
        const { data: freePostRow } = await supabase
          .from("free_posts_used")
          .select("id")
          .eq("user_id", user.id)
          .eq("area", area)
          .maybeSingle();

        const freePostUsed = !!freePostRow;
        // In testing mode, keep the free-post flow open and remove the posting count cap.
        const freePostAvailable = !entitlement && (postingLimitBypassEnabled || !freePostUsed);

        // Legacy trial compat: treat free-post-available as "trial" for rendering
        const isTrial = freePostAvailable;
        const trialDaysLeft = freePostAvailable ? FREE_POST_CONFIG.durationDays : 0;

        // Count existing items for this area
        const table = AREA_COUNT_TABLES[area];
        const { count } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq("seller_id", user.id)
          .neq("status", "rejected");

        const currentCount = count ?? 0;

        // Get entitlements for their plan
        const effectiveTier: PlanTier = tier || TRIAL_CONFIG.tier;
        const ent = getEntitlements(effectiveTier, area);

        // Testing mode keeps free-tier media limits but removes posting-count caps.
        const maxAllowed = postingLimitBypassEnabled
          ? -1
          : freePostAvailable
            ? FREE_POST_CONFIG.maxAllowed
            : tier
              ? ent.maxAllowed
              : 0;
        const maxPhotos = freePostAvailable
          ? FREE_POST_CONFIG.maxPhotos
          : tier
            ? ent.maxPhotos
            : FREE_POST_CONFIG.maxPhotos;
        const maxVideos = postingLimitBypassEnabled
          ? FREE_POST_CONFIG.maxVideos
          : freePostAvailable
            ? FREE_POST_CONFIG.maxVideos
            : tier
              ? ent.maxVideos
              : 0;

        setPlanInfo({
          tier: tier || "free",
          isTrial,
          trialDaysLeft,
          freePostAvailable,
          postingLimitBypassEnabled,
          currentCount,
          maxAllowed,
          maxPhotos,
          maxVideos,
          videoAllowed: postingLimitBypassEnabled
            ? FREE_POST_CONFIG.videoAllowed
            : freePostAvailable
              ? FREE_POST_CONFIG.videoAllowed
              : tier
                ? ent.videoAllowed
                : false,
        });
      } catch {
        setError("failed");
      } finally {
        setLoading(false);
      }
    }

    checkEntitlements();
  }, [area]);

  // Handle subscribe — redirect to checkout
  async function handleSubscribe(plan: PlanDefinition) {
    const key = `${plan.area}-${plan.tier}`;
    setSubscribing(key);
    try {
      // First fetch the plan ID from the plans table
      const supabase = createClient();
      const { data: dbPlan } = await supabase
        .from("plans")
        .select("id")
        .eq("area", plan.area)
        .eq("tier", plan.tier)
        .eq("active", true)
        .single();

      if (!dbPlan) {
        throw new Error("Plan not available");
      }

      // Use the checkout API
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: dbPlan.id, area: plan.area }),
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      throw new Error(data.error || "No checkout URL received");
    } catch (err) {
      logger.error("Checkout error", { error: err instanceof Error ? err.message : String(err) });
      // Show user-facing error feedback
      const errorMessage = err instanceof Error ? err.message : "Could not start checkout";
      setError("failed");
      toast({
        title: "Checkout failed",
        description: `${errorMessage}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setSubscribing(null);
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-brand-green mx-auto" />
          <p className="text-sm text-muted-foreground">Checking your plan...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (error === "not_authenticated") {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardContent className="p-6 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
          <h2 className="font-display text-xl font-bold">Sign In Required</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            You need to be signed in and have a seller profile to post on VerifyMzansi.
          </p>
          <div className="flex gap-3 justify-center">
            <Button asChild variant="outline">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild className="gap-2">
              <Link href="/register">
                Register Free <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // No seller profile
  if (error === "no_profile") {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardContent className="p-6 text-center space-y-3">
          <ShieldCheck className="h-8 w-8 text-amber-500 mx-auto" />
          <h2 className="font-display text-xl font-bold">Complete Your Profile</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Set up your seller profile to start posting on VerifyMzansi. It takes less than 5
            minutes.
          </p>
          <Button asChild className="gap-2">
            <Link href="/register">
              Set Up Profile <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Generic error
  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-6 text-center space-y-3">
          <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
          <h2 className="font-display text-xl font-bold">Something Went Wrong</h2>
          <p className="text-muted-foreground">
            We couldn&apos;t check your plan. Please try again.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!planInfo) return null;

  // Get plans for this area
  const areaPlans = PLANS.filter((p) => p.area === area);

  // ── No plan and trial expired → must subscribe ──
  if (planInfo.tier === "free" && !planInfo.isTrial) {
    return (
      <div className="space-y-3">
        <div className="bg-gradient-to-r from-brand-green to-emerald-600 rounded-lg p-4 text-white">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4" />
            <h2 className="font-display text-base font-bold">Choose Your Plan to Start Posting</h2>
          </div>
          <p className="text-white/80 text-xs max-w-xl">
            You&apos;ve used your free post for {AREA_LABELS[area]}. Select a plan below to continue
            posting.
          </p>
        </div>

        <PlanComparisonTable
          plans={areaPlans}
          onSubscribe={handleSubscribe}
          subscribing={subscribing}
        />

        <p className="text-center text-xs text-muted-foreground">
          All plans include verification badge • Cancel anytime •{" "}
          <Link href="/billing" className="text-brand-green underline">
            View full plan details
          </Link>
        </p>
      </div>
    );
  }

  // ── At listing limit → inline upgrade picker ──
  const isUnlimited = planInfo.maxAllowed === -1;
  if (!isUnlimited && planInfo.currentCount >= planInfo.maxAllowed) {
    const tierOrder: Record<string, number> = { basic: 0, starter: 1, growth: 2, pro: 3 };
    const currentTierOrder = planInfo.isTrial ? -1 : (tierOrder[planInfo.tier] ?? -1);
    const upgradePlans = areaPlans.filter((p) => tierOrder[p.tier] > currentTierOrder);

    return (
      <div className="space-y-6">
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-amber-500 flex-shrink-0" />
              <div>
                <h2 className="font-display text-lg font-bold">Posting Limit Reached</h2>
                <p className="text-sm text-muted-foreground">
                  You&apos;ve used{" "}
                  <strong>
                    {planInfo.currentCount}/{planInfo.maxAllowed}
                  </strong>{" "}
                  {AREA_ITEM_LABELS[area]} on your{" "}
                  <Badge variant="outline" className="capitalize mx-1 text-xs">
                    {planInfo.isTrial ? "Free Post" : planInfo.tier}
                  </Badge>{" "}
                  plan. Upgrade to post more and unlock premium features.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {upgradePlans.length > 0 && (
          <PlanComparisonTable
            plans={upgradePlans}
            onSubscribe={handleSubscribe}
            subscribing={subscribing}
          />
        )}
      </div>
    );
  }

  // ── Trial user or no paid plan → show plan picker FIRST, with Continue Trial option ──
  if (planInfo.isTrial || planInfo.tier === "free") {
    return (
      <PlanPickerWithTrial
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
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
        <Badge className={AREA_COLORS[area]}>{AREA_LABELS[area]}</Badge>

        <Badge variant="outline" className="capitalize">
          {planInfo.tier} Plan
        </Badge>

        <div className="flex items-center gap-3 text-sm text-muted-foreground ml-auto">
          <span className="flex items-center gap-1">
            <Camera className="h-3.5 w-3.5" />
            {planInfo.maxPhotos} photos
          </span>
          {planInfo.videoAllowed && (
            <span className="flex items-center gap-1 text-brand-green">
              <Video className="h-3.5 w-3.5" />
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
  area,
  planInfo,
  areaPlans,
  onSubscribe,
  subscribing,
  children,
}: {
  area: MarketplaceArea;
  planInfo: PlanInfo;
  areaPlans: PlanDefinition[];
  onSubscribe: (plan: PlanDefinition) => void;
  subscribing: string | null;
  children: ReactNode;
}) {
  const [showForm, setShowForm] = useState(false);
  const usageText =
    planInfo.maxAllowed === -1
      ? "Unlimited posts"
      : `${planInfo.currentCount}/${planInfo.maxAllowed} ${AREA_ITEM_LABELS[area]} used`;

  if (showForm) {
    return (
      <div className="space-y-4">
        {/* Free post status bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
          <Badge className={AREA_COLORS[area]}>{AREA_LABELS[area]}</Badge>

          <div className="flex items-center gap-1.5 text-sm">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              {planInfo.postingLimitBypassEnabled
                ? `Testing Mode — Unlimited posts • ${FREE_POST_CONFIG.maxPhotos} photos • ${FREE_POST_CONFIG.maxVideos} video`
                : `Free Post — ${FREE_POST_CONFIG.durationDays} days • ${FREE_POST_CONFIG.maxPhotos} photos • ${FREE_POST_CONFIG.maxVideos} video`}
            </span>
          </div>

          <div className="flex items-center gap-3 text-sm text-muted-foreground ml-auto">
            <span className="flex items-center gap-1">
              <Camera className="h-3.5 w-3.5" />
              {planInfo.maxPhotos} photos
            </span>
            <span className="flex items-center gap-1 text-brand-green">
              <Video className="h-3.5 w-3.5" />1 video
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
        <div className="bg-gradient-to-r from-brand-green to-emerald-600 rounded-lg p-4 text-white shadow-md">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-300" />
                <h2 className="font-display text-base font-bold">Choose How You Want to Post</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-xs font-normal border-white/30 text-white bg-white/10"
                >
                  {planInfo.postingLimitBypassEnabled ? "Testing Mode" : "One-Time Offer"}
                </Badge>
                <p className="text-xs text-amber-200">
                  {planInfo.postingLimitBypassEnabled
                    ? `Posting limits removed for testing — ${FREE_POST_CONFIG.maxPhotos} photos • ${FREE_POST_CONFIG.maxVideos} video`
                    : `1 Free Post Included — ${FREE_POST_CONFIG.durationDays} days visibility`}
                </p>
              </div>
              <p className="text-white/70 text-xs">
                {planInfo.postingLimitBypassEnabled
                  ? `Each post still uses free-tier media limits: ${FREE_POST_CONFIG.maxPhotos} photos and ${FREE_POST_CONFIG.maxVideos} video.`
                  : `Post once for free. ${FREE_POST_CONFIG.maxPhotos} photos • ${FREE_POST_CONFIG.maxVideos} video • ${FREE_POST_CONFIG.durationDays} days • Once per area`}
              </p>
            </div>
            <Button
              className="gap-2 bg-amber-500 hover:bg-amber-600 text-white shadow-sm border-0 whitespace-nowrap"
              onClick={() => setShowForm(true)}
            >
              <ArrowRight className="h-4 w-4" />
              {planInfo.postingLimitBypassEnabled ? "Start Posting" : "Use Your Free Post"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-gradient-to-r from-brand-green to-emerald-600 rounded-lg p-4 text-white shadow-md">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <h2 className="font-display text-base font-bold">Choose How You Want to Post</h2>
          </div>
          <p className="text-white/80 text-xs mt-1">
            Subscribe to a 30-day plan for the best value on {AREA_LABELS[area]}.
          </p>
        </div>
      )}

      {/* ── Section 2: Monthly Plans ─── */}
      <div className="space-y-2">
        <h3 className="font-display text-sm font-bold flex items-center gap-2">
          <Crown className="h-4 w-4 text-brand-gold" />
          Add a Payment Plan
          <Badge variant="outline" className="text-xs font-normal">
            Best Value
          </Badge>
        </h3>
        <PlanComparisonTable
          plans={areaPlans}
          onSubscribe={onSubscribe}
          subscribing={subscribing}
        />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        All plans include verification badge • Cancel anytime •{" "}
        <Link href="/billing" className="text-brand-green underline">
          View full plan details
        </Link>
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Hook: usePlanMaxPhotos
   ───────────────────────────────────────────────────────────── */
export function usePlanMaxPhotos(area: MarketplaceArea): number {
  const [maxPhotos, setMaxPhotos] = useState<number>(FREE_POST_CONFIG.maxPhotos); // default free tier (5)

  useEffect(() => {
    async function fetchMaxPhotos() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        // Check for active entitlement for this area
        const { data: entitlement } = await supabase
          .from("entitlements")
          .select("tier, expires_at")
          .eq("user_id", user.id)
          .eq("area", area)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const tier = (entitlement?.tier as PlanTier) || null;
        if (tier) {
          const ent = getEntitlements(tier, area);
          setMaxPhotos(ent.maxPhotos);
        } else {
          // No active paid plan — use free post photo limit
          setMaxPhotos(FREE_POST_CONFIG.maxPhotos);
        }
      } catch {
        // Keep default
      }
    }

    fetchMaxPhotos();
  }, [area]);

  return maxPhotos;
}

/* ─────────────────────────────────────────────────────────────
   Hook: usePlanVideoAllowed
   ───────────────────────────────────────────────────────────── */
export function usePlanVideoAllowed(area: MarketplaceArea): boolean {
  const [videoAllowed, setVideoAllowed] = useState(false); // default free tier

  useEffect(() => {
    async function fetchVideoAllowed() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const postingLimitBypassEnabled = isPostingLimitBypassEnabled();

        // Check for active entitlement for this area
        const { data: entitlement } = await supabase
          .from("entitlements")
          .select("tier, expires_at")
          .eq("user_id", user.id)
          .eq("area", area)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const tier = (entitlement?.tier as PlanTier) || null;
        if (tier) {
          const ent = getEntitlements(tier, area);
          setVideoAllowed(ent.videoAllowed);
        } else if (postingLimitBypassEnabled) {
          setVideoAllowed(FREE_POST_CONFIG.videoAllowed);
        } else {
          // Check if free post is still available (not yet used)
          const { data: freePostRow } = await supabase
            .from("free_posts_used")
            .select("id")
            .eq("user_id", user.id)
            .eq("area", area)
            .maybeSingle();

          // Free post includes video; if already used → no video without a plan
          setVideoAllowed(!freePostRow);
        }
      } catch {
        // Keep default
      }
    }

    fetchVideoAllowed();
  }, [area]);

  return videoAllowed;
}

/* ─────────────────────────────────────────────────────────────
   Hook: usePlanMaxVideos
   ───────────────────────────────────────────────────────────── */
export function usePlanMaxVideos(area: MarketplaceArea): number {
  const [maxVideos, setMaxVideos] = useState<number>(FREE_POST_CONFIG.maxVideos);

  useEffect(() => {
    async function fetchMaxVideos() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const postingLimitBypassEnabled = isPostingLimitBypassEnabled();

        const { data: entitlement } = await supabase
          .from("entitlements")
          .select("tier, expires_at")
          .eq("user_id", user.id)
          .eq("area", area)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const tier = (entitlement?.tier as PlanTier) || null;
        if (tier) {
          const ent = getEntitlements(tier, area);
          setMaxVideos(ent.maxVideos);
        } else if (postingLimitBypassEnabled) {
          setMaxVideos(FREE_POST_CONFIG.maxVideos);
        } else {
          const { data: freePostRow } = await supabase
            .from("free_posts_used")
            .select("id")
            .eq("user_id", user.id)
            .eq("area", area)
            .maybeSingle();

          setMaxVideos(freePostRow ? 0 : FREE_POST_CONFIG.maxVideos);
        }
      } catch {
        // Keep default
      }
    }

    fetchMaxVideos();
  }, [area]);

  return maxVideos;
}

export function usePlanCoverVideoAllowed(area: MarketplaceArea): boolean {
  const [coverVideoAllowed, setCoverVideoAllowed] = useState(false);

  useEffect(() => {
    async function fetchCoverVideoAllowed() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: entitlement } = await supabase
          .from("entitlements")
          .select("tier, expires_at")
          .eq("user_id", user.id)
          .eq("area", area)
          .eq("status", "active")
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const tier = (entitlement?.tier as PlanTier) || null;
        if (tier) {
          const ent = getEntitlements(tier, area);
          setCoverVideoAllowed(ent.coverVideoAllowed);
          return;
        }

        setCoverVideoAllowed(false);
      } catch {
        // Keep default
      }
    }

    fetchCoverVideoAllowed();
  }, [area]);

  return coverVideoAllowed;
}
