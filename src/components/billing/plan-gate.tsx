"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import { toast } from "@/hooks/use-toast";
import { withCsrfHeaders } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { isPostingLimitBypassEnabled } from "../../lib/utils/posting-limit-bypass";
import {
  getOwnerColumn,
  OWNER_COMPAT_TABLES,
  type OwnerCompatibleTable,
} from "@/lib/account/compat";

const logger = createLogger("PlanGate");
import {
  PLANS,
  TRIAL_CONFIG,
  FREE_POST_CONFIG,
  getPlanCheckoutId,
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
  PROMOTIONS_EVENTS: "Tourism & Events",
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
   Inline Plan Grid — compact cards matching the pricing page
   ───────────────────────────────────────────────────────────── */
function planFeatureList(plan: PlanDefinition): { text: string; enabled: boolean }[] {
  const f = plan.features;
  const rows: { text: string; enabled: boolean }[] = [];

  const maxItems =
    f.maxListings ?? f.maxStorefronts ?? f.maxProfiles ?? f.maxBusinesses ?? f.maxPromotions ?? 0;
  const itemLabel =
    plan.area === "MALL_SHOPS"
      ? "storefronts"
      : plan.area === "BUSINESS_ADS"
        ? "profiles"
        : plan.area === "MZANSI_BUSINESS"
          ? "businesses"
          : plan.area === "PROMOTIONS_EVENTS"
            ? "promotions"
            : "listings";

  rows.push({ text: `${maxItems === -1 ? "Unlimited" : maxItems} ${itemLabel}`, enabled: true });
  rows.push({ text: `${f.maxPhotos} photos per listing`, enabled: true });
  rows.push({ text: "Boost listings", enabled: f.boostAllowed });
  rows.push({ text: "Featured placement", enabled: f.featuredAllowed });
  if (f.videoAllowed) {
    const vCount = (f as Record<string, unknown>).maxVideos as number | undefined;
    rows.push({ text: `${vCount ?? 1} video tour${(vCount ?? 1) > 1 ? "s" : ""}`, enabled: true });
  } else {
    rows.push({ text: "Video tours", enabled: false });
  }
  return rows;
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
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 ${
        plans.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
      } gap-3 max-w-4xl mx-auto`}
    >
      {plans.map((plan) => {
        const isPopular = plan.tier === "growth";
        const isPremium = plan.tier === "pro";
        const features = planFeatureList(plan);
        return (
          <Card
            key={`${plan.area}-${plan.tier}`}
            className={`relative ${
              isPopular
                ? "border-brand-green shadow-md ring-1 ring-brand-green/20"
                : isPremium
                  ? "border-brand-gold/50"
                  : ""
            }`}
          >
            {isPopular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-brand-green text-white gap-1 text-[10px] px-2 py-0.5 whitespace-nowrap">
                  <Sparkles className="h-3 w-3" />
                  MOST POPULAR
                </Badge>
              </div>
            )}
            {isPremium && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-brand-gold text-amber-950 gap-1 text-[10px] px-2 py-0.5 whitespace-nowrap">
                  <Crown className="h-3 w-3" />
                  PREMIUM
                </Badge>
              </div>
            )}

            <CardContent className="p-4 pt-5 space-y-3">
              {/* Plan name + price */}
              <div className="text-center">
                <h3 className="font-display text-base font-bold capitalize">{plan.tier}</h3>
                <div className="mt-0.5">
                  <span className="font-display text-2xl font-bold">R{plan.priceCents / 100}</span>
                  <span className="text-xs text-muted-foreground"> / 30 days</span>
                </div>
              </div>

              {/* Feature list */}
              <ul className="space-y-1.5 text-sm">
                {features.map((feat) => (
                  <li key={feat.text} className="flex items-center gap-1.5">
                    {feat.enabled ? (
                      <Check className="h-4 w-4 text-brand-green flex-shrink-0" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                    )}
                    <span className={feat.enabled ? "" : "text-muted-foreground/60"}>
                      {feat.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Subscribe button */}
              <Button
                className="w-full gap-1.5 text-sm"
                size="sm"
                variant={isPopular ? "default" : "outline"}
                disabled={subscribing !== null}
                onClick={() => onSubscribe(plan)}
              >
                {subscribing === `${plan.area}-${plan.tier}` ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Processing…
                  </>
                ) : (
                  `Choose ${plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}`
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
export function PlanGate({ area, children }: PlanGateProps) {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (isPlaywrightTestMode()) {
      setPlanInfo({
        tier: "free",
        isTrial: true,
        trialDaysLeft: FREE_POST_CONFIG.durationDays,
        freePostAvailable: true,
        postingLimitBypassEnabled: true,
        currentCount: 0,
        maxAllowed: -1,
        maxPhotos: FREE_POST_CONFIG.maxPhotos,
        maxVideos: FREE_POST_CONFIG.maxVideos,
        videoAllowed: FREE_POST_CONFIG.videoAllowed,
      });
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function checkEntitlements() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (cancelled) return;

        if (!user) {
          setError("not_authenticated");
          setLoading(false);
          return;
        }

        // Get account profile — just check it exists.
        const { data: profile } = await supabase
          .from("account_profiles")
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
        const ownerCol = (OWNER_COMPAT_TABLES as readonly string[]).includes(table)
          ? await getOwnerColumn(supabase, table as OwnerCompatibleTable)
          : "owner_id";
        const { count } = await supabase
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq(ownerCol, user.id)
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

        if (cancelled) return;

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

    // Re-check when tab becomes visible (handles cross-tab free post consumption)
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        _entitlementCache.clear();
        checkEntitlements();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [area]);

  // Handle subscribe — redirect to checkout
  async function handleSubscribe(plan: PlanDefinition) {
    const key = `${plan.area}-${plan.tier}`;
    setSubscribing(key);
    setCheckoutError(null);
    try {
      // Use the checkout API
      const res = await fetch("/api/billing/create-checkout", {
        method: "POST",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ planId: getPlanCheckoutId(plan) }),
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
      setCheckoutError(`${errorMessage}. Please try again.`);
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
          <p className="text-sm text-muted-foreground">Checking your plan</p>
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
          <h2 className="font-display text-xl font-bold">Sign in required</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Sign in to choose a plan or use your free post on VerifyMzansi.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
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

  // No account profile
  if (error === "no_profile") {
    return (
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
        <CardContent className="p-6 text-center space-y-3">
          <ShieldCheck className="h-8 w-8 text-amber-500 mx-auto" />
          <h2 className="font-display text-xl font-bold">Add Your Phone Number</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Add your phone number before posting so buyers can trust your account and receive your
            updates.
          </p>
          <Button asChild className="gap-2">
            <Link href={`/dashboard/complete-profile?returnUrl=${encodeURIComponent(pathname)}`}>
              Add Phone Number <ArrowRight className="h-4 w-4" />
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
          <h2 className="font-display text-xl font-bold">We couldn't load your plan</h2>
          <p className="text-muted-foreground">Try again in a moment.</p>
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

        <InlinePlanGrid plans={areaPlans} onSubscribe={handleSubscribe} subscribing={subscribing} />

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
                  plan. Upgrade to continue posting in this category.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {upgradePlans.length > 0 && (
          <InlinePlanGrid
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
        checkoutError={checkoutError}
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
  checkoutError,
  children,
}: {
  area: MarketplaceArea;
  planInfo: PlanInfo;
  areaPlans: PlanDefinition[];
  onSubscribe: (plan: PlanDefinition) => void;
  subscribing: string | null;
  checkoutError: string | null;
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
      {checkoutError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-destructive">Checkout unavailable</p>
            <p className="mt-1 text-muted-foreground">{checkoutError}</p>
          </CardContent>
        </Card>
      )}
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
        <InlinePlanGrid plans={areaPlans} onSubscribe={onSubscribe} subscribing={subscribing} />
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
   Shared entitlement fetch — deduplicates getUser() + DB calls
   when multiple hooks are used in the same component / page.
   ───────────────────────────────────────────────────────────── */
interface PlanEntitlementInfo {
  maxPhotos: number;
  maxVideos: number;
  videoAllowed: boolean;
  coverVideoAllowed: boolean;
}

const ENTITLEMENT_CACHE_TTL = 30_000; // 30 s
const _entitlementCache = new Map<string, { promise: Promise<PlanEntitlementInfo>; ts: number }>();

function fetchSharedEntitlements(area: MarketplaceArea): Promise<PlanEntitlementInfo> {
  const now = Date.now();
  const cached = _entitlementCache.get(area);
  if (cached && now - cached.ts < ENTITLEMENT_CACHE_TTL) return cached.promise;

  const promise = (async (): Promise<PlanEntitlementInfo> => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return {
        maxPhotos: FREE_POST_CONFIG.maxPhotos,
        maxVideos: FREE_POST_CONFIG.maxVideos,
        videoAllowed: false,
        coverVideoAllowed: false,
      };
    }

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
      return {
        maxPhotos: ent.maxPhotos,
        maxVideos: ent.maxVideos,
        videoAllowed: ent.videoAllowed,
        coverVideoAllowed: ent.coverVideoAllowed,
      };
    }

    if (postingLimitBypassEnabled) {
      return {
        maxPhotos: FREE_POST_CONFIG.maxPhotos,
        maxVideos: FREE_POST_CONFIG.maxVideos,
        videoAllowed: FREE_POST_CONFIG.videoAllowed,
        coverVideoAllowed: false,
      };
    }

    // No plan, no bypass — check if free post is still available
    const { data: freePostRow } = await supabase
      .from("free_posts_used")
      .select("id")
      .eq("user_id", user.id)
      .eq("area", area)
      .maybeSingle();

    return {
      maxPhotos: FREE_POST_CONFIG.maxPhotos,
      maxVideos: freePostRow ? 0 : FREE_POST_CONFIG.maxVideos,
      videoAllowed: !freePostRow,
      coverVideoAllowed: false,
    };
  })();

  _entitlementCache.set(area, { promise, ts: now });
  return promise;
}

function usePlanEntitlements(area: MarketplaceArea): PlanEntitlementInfo {
  const [info, setInfo] = useState<PlanEntitlementInfo>(() => ({
    maxPhotos: FREE_POST_CONFIG.maxPhotos,
    maxVideos: isPlaywrightTestMode() ? FREE_POST_CONFIG.maxVideos : FREE_POST_CONFIG.maxVideos,
    videoAllowed: isPlaywrightTestMode() ? FREE_POST_CONFIG.videoAllowed : false,
    coverVideoAllowed: false,
  }));

  useEffect(() => {
    if (isPlaywrightTestMode()) return;
    let cancelled = false;
    fetchSharedEntitlements(area).then((result) => {
      if (!cancelled) setInfo(result);
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

export function usePlanCoverVideoAllowed(area: MarketplaceArea): boolean {
  const entitlements = usePlanEntitlements(area);
  // Unified Mzansi Business uses its normal video allowance for the cover slot.
  return area === "MZANSI_BUSINESS"
    ? entitlements.videoAllowed || entitlements.coverVideoAllowed
    : entitlements.coverVideoAllowed;
}
