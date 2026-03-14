"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CalendarDays, Eye, Megaphone, ShieldCheck, Store, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { PromotionCard } from "@/components/listings/promotion-card";
import { PromotionFilterPanel } from "@/components/listings/promotion-filter-panel";
import { PromotionFilterDrawer } from "@/components/listings/promotion-filter-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCitiesForProvince } from "@/lib/constants/sa-provinces";
import {
  PROMOTION_TYPE_LABELS,
  type BusinessCategory,
  type PromotionEventState,
  type PromotionType,
  type TrustLevel,
} from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { formatZAR } from "@/lib/utils/format";
import { triggerHaptic } from "@/lib/utils/haptics";

interface PromotionRow {
  id: string;
  owner_id: string;
  business_id: string | null;
  title: string;
  promotion_type: PromotionType;
  category: string | null;
  category_key: BusinessCategory | null;
  photos: string[] | null;
  videos: string[] | null;
  video_thumbnail: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  start_date: string | null;
  end_date: string | null;
  boost_until: string | null;
  featured_until: string | null;
  view_count: number;
  created_at: string;
}

interface AccountProfileSummary {
  user_id: string;
  display_name: string;
  trust: TrustLevel;
}

interface BusinessSummary {
  id: string;
  business_name: string;
}

interface PromotionsResponse {
  promotions?: PromotionRow[];
  accountProfiles?: AccountProfileSummary[];
  sellers?: AccountProfileSummary[];
  businesses?: BusinessSummary[];
  total?: number;
  page?: number;
  limit?: number;
  error?: string;
}

const PROMOTION_USE_CASES = [
  {
    title: "Retail specials",
    description:
      "Move stock quickly with weekend deals, clearance campaigns, and limited-time offers.",
    icon: Store,
  },
  {
    title: "Launches and openings",
    description:
      "Announce a new service, store opening, menu drop, or product launch with urgency.",
    icon: Zap,
  },
  {
    title: "Events that need attendance",
    description:
      "Promote date-based events, activations, and public gatherings from verified businesses.",
    icon: CalendarDays,
  },
] as const;

const PROMOTION_ADVANTAGES = [
  "Verified businesses and members build more trust than anonymous social posts.",
  "Location and category filters help nearby clients find offers that matter to them.",
  "Time-sensitive campaigns belong here without changing your main business profile.",
] as const;

export function normalizeValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function PromotionsExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const currentSearchParams = useMemo(() => new URLSearchParams(searchParamKey), [searchParamKey]);
  const [response, setResponse] = useState<PromotionsResponse>({
    promotions: [],
    accountProfiles: [],
    sellers: [],
    businesses: [],
    total: 0,
    page: 1,
    limit: 24,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      query: normalizeValue(currentSearchParams.get("q")),
      type: normalizeValue(currentSearchParams.get("type")) as PromotionType | undefined,
      category: normalizeValue(currentSearchParams.get("category")) as BusinessCategory | undefined,
      province: normalizeValue(currentSearchParams.get("province")),
      city: normalizeValue(currentSearchParams.get("city")),
      businessId: normalizeValue(currentSearchParams.get("business_id")),
      eventState: normalizeValue(currentSearchParams.get("event_state")) as
        | PromotionEventState
        | undefined,
      page: Math.max(1, parseInt(currentSearchParams.get("page") || "1", 10)),
    }),
    [currentSearchParams]
  );

  const updateFilters = useCallback(
    (updates: Record<string, string | undefined>, options?: { preservePage?: boolean }) => {
      const next = new URLSearchParams(searchParamKey);

      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === "") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      }

      if (!options?.preservePage) {
        next.delete("page");
      }

      const nextKey = next.toString();
      router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
    },
    [pathname, router, searchParamKey]
  );

  const cities = filters.province ? getCitiesForProvince(filters.province) : [];
  const debouncedUpdateQuery = useDebouncedCallback((value: string) => {
    updateFilters({ q: value || undefined });
  }, 300);

  const clearQueryFilter = () => {
    debouncedUpdateQuery.cancel();
    updateFilters({ q: undefined });
  };

  const clearAllFilters = () => {
    debouncedUpdateQuery.cancel();
    router.replace(pathname, { scroll: false });
  };

  const handleTypeChange = useCallback(
    (value: PromotionType | undefined) => {
      updateFilters({
        type: value,
        event_state: value === "event" ? filters.eventState : undefined,
      });
    },
    [filters.eventState, updateFilters]
  );

  const handleProvinceChange = useCallback(
    (value: string | undefined) => {
      updateFilters({
        province: value,
        city: undefined,
      });
    },
    [updateFilters]
  );

  const handleEventStateChange = useCallback(
    (value: PromotionEventState | undefined) => {
      updateFilters({
        type: value ? "event" : filters.type,
        event_state: value,
      });
    },
    [filters.type, updateFilters]
  );

  useEffect(() => {
    let active = true;

    async function loadPromotions() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams(searchParamKey);
        params.set("limit", "24");

        const res = await fetch(`/api/promotions?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as PromotionsResponse;

        if (!active) return;

        if (!res.ok) {
          setError(payload.error || "Failed to load Promotions & Events.");
          setResponse({
            promotions: [],
            accountProfiles: [],
            sellers: [],
            businesses: [],
            total: 0,
            page: 1,
            limit: 24,
          });
          setLoading(false);
          return;
        }

        setResponse(payload);
        setLoading(false);
      } catch (loadError) {
        if (!active) return;

        setError(
          loadError instanceof Error ? loadError.message : "Failed to load Promotions & Events."
        );
        setResponse({
          promotions: [],
          accountProfiles: [],
          sellers: [],
          businesses: [],
          total: 0,
          page: 1,
          limit: 24,
        });
        setLoading(false);
      }
    }

    void loadPromotions();

    return () => {
      active = false;
    };
  }, [searchParamKey]);

  const accountProfileMap = useMemo(
    () =>
      new Map(
        (response.accountProfiles ?? response.sellers ?? []).map((accountProfile) => [
          accountProfile.user_id,
          accountProfile,
        ])
      ),
    [response.accountProfiles, response.sellers]
  );
  const businessMap = useMemo(
    () =>
      new Map((response.businesses ?? []).map((business) => [business.id, business.business_name])),
    [response.businesses]
  );
  const promotions = response.promotions ?? [];
  const total = response.total ?? 0;
  const page = response.page ?? filters.page;
  const limit = response.limit ?? 24;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // Find featured/boosted promotion for hero (only on page 1, no filters active)
  const now = new Date();
  const featuredPromotion =
    page === 1
      ? promotions.find(
          (p) =>
            (p.featured_until && new Date(p.featured_until) > now) ||
            (p.boost_until && new Date(p.boost_until) > now)
        )
      : undefined;
  const gridPromotions = featuredPromotion
    ? promotions.filter((p) => p.id !== featuredPromotion.id)
    : promotions;

  return (
    <div className="container mx-auto px-4 py-6 space-y-5 max-w-7xl">
      <PageHeader
        title="Promotions & Events"
        description="Advertise time-sensitive offers, launches, specials, and events from verified South African businesses."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Promotions & Events" }]}
        className="hidden lg:block"
      >
        <Button asChild size="sm" className="gap-1">
          <Link href="/post/create-promotion">
            Post in Promotions & Events
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </PageHeader>

      <Card className="overflow-hidden border-red-200/70 bg-gradient-to-br from-red-50 via-white to-amber-50 dark:border-red-900/60 dark:from-red-950/30 dark:via-background dark:to-amber-950/20">
        <CardContent className="space-y-6 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-red-700 text-white hover:bg-red-700">
                  For verified business campaigns
                </Badge>
                <Badge variant="outline">Deals, launches, events, specials</Badge>
              </div>
              <div className="space-y-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl lg:hidden">
                  Promotions & Events
                </h1>
                <p className="text-base text-foreground/90 sm:text-lg">
                  Use this space when you need urgency: launch a product, fill seats for an event,
                  push a short-run special, or get local attention for a new offer.
                </p>
                <p className="text-sm text-muted-foreground sm:text-base">
                  Best for restaurants, salons, shops, service businesses, event organisers, and
                  growing brands that need a verified place to promote something now.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:min-w-56 lg:flex-col lg:items-stretch">
              <Button asChild className="gap-1 bg-red-700 hover:bg-red-800">
                <Link href="/post/create-promotion">
                  Post in Promotions & Events
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-1">
                <Link href="/promotions/events">
                  Browse Events
                  <CalendarDays className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {PROMOTION_USE_CASES.map((item) => {
              const Icon = item.icon;

              return (
                <div
                  key={item.title}
                  className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="font-medium text-foreground">{item.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-dashed border-red-300/80 bg-background/70 p-4 dark:border-red-900/80">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="space-y-2">
                <h2 className="font-medium text-foreground">Why businesses post here</h2>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {PROMOTION_ADVANTAGES.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Mobile filter drawer (FAB visible < lg only) */}
      <PromotionFilterDrawer
        filters={filters}
        cities={cities}
        businessMap={businessMap}
        onQueryChange={debouncedUpdateQuery}
        onTypeChange={handleTypeChange}
        onCategoryChange={(value) => updateFilters({ category: value })}
        onProvinceChange={handleProvinceChange}
        onCityChange={(value) => updateFilters({ city: value })}
        onEventStateChange={handleEventStateChange}
        onClearQuery={clearQueryFilter}
        onClearAll={clearAllFilters}
      />

      <div className="lg:flex lg:gap-6">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-24">
            <PromotionFilterPanel
              filters={filters}
              cities={cities}
              businessMap={businessMap}
              onQueryChange={debouncedUpdateQuery}
              onTypeChange={handleTypeChange}
              onCategoryChange={(value) => updateFilters({ category: value })}
              onProvinceChange={handleProvinceChange}
              onCityChange={(value) => updateFilters({ city: value })}
              onEventStateChange={handleEventStateChange}
              onClearQuery={clearQueryFilter}
              onClearAll={clearAllFilters}
            />
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          {/* ── Featured Hero Card ── */}
          {featuredPromotion && !loading && (
            <div className="hidden sm:block">
              <FeaturedHeroCard
                promotion={featuredPromotion}
                businessName={
                  featuredPromotion.business_id
                    ? businessMap.get(featuredPromotion.business_id)
                    : undefined
                }
              />
            </div>
          )}

          {/* ── Results Count + CTA ── */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
              <span className="font-medium text-foreground">{total}</span> promotion
              {total === 1 ? "" : "s"} found
            </p>
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex gap-1">
              <Link href="/post/create-promotion">
                Post in Promotions & Events
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* ── Grid / Loading / Error / Empty ── */}
          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="aspect-[4/5] rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="font-display text-lg font-semibold">
                  Unable to load Promotions &amp; Events
                </h3>
                <p className="text-sm text-muted-foreground">{error}</p>
              </CardContent>
            </Card>
          ) : gridPromotions.length === 0 && !featuredPromotion ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="font-display text-lg font-semibold">
                  No Promotions &amp; Events posts match your filters
                </h3>
                <p className="text-sm text-muted-foreground">
                  Try broadening the search, or post your own campaign for a local special, launch,
                  or event.
                </p>
                <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                  <Button variant="outline" size="sm" onClick={clearAllFilters}>
                    Clear all filters
                  </Button>
                  <Button asChild size="sm" className="gap-1 bg-red-700 hover:bg-red-800">
                    <Link href="/post/create-promotion">
                      Post in Promotions & Events
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {gridPromotions.map((promotion, index) => {
                  const accountProfile = accountProfileMap.get(promotion.owner_id);
                  const businessName = promotion.business_id
                    ? businessMap.get(promotion.business_id)
                    : undefined;
                  const isBoosted = promotion.boost_until
                    ? new Date(promotion.boost_until) > now
                    : false;
                  const isFeatured = promotion.featured_until
                    ? new Date(promotion.featured_until) > now
                    : false;

                  return (
                    <div
                      key={promotion.id}
                      className={`animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms] [animation-delay:${Math.min(index * 50, 400)}ms]`}
                    >
                      <PromotionCard
                        id={promotion.id}
                        title={promotion.title}
                        price={promotion.price_cents}
                        negotiable={promotion.price_negotiable}
                        imageUrl={promotion.videos?.[0] || promotion.photos?.[0]}
                        posterUrl={promotion.video_thumbnail || promotion.photos?.[0] || undefined}
                        categoryLabel={getPromotionCategoryDisplayLabel(
                          promotion.category_key,
                          promotion.category
                        )}
                        province={promotion.location_province}
                        city={promotion.location_city}
                        promotionType={promotion.promotion_type}
                        createdAt={promotion.created_at}
                        ownerTrustLevel={accountProfile?.trust}
                        ownerName={accountProfile?.display_name}
                        viewCount={promotion.view_count}
                        boosted={isBoosted}
                        featured={isFeatured}
                        startDate={promotion.start_date}
                        endDate={promotion.end_date}
                        businessName={businessName}
                      />
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={page <= 1}
                    onClick={() => {
                      triggerHaptic("light");
                      updateFilters({ page: String(page - 1) }, { preservePage: true });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Previous
                  </Button>

                  <div className="hidden sm:flex items-center gap-1">
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
                      const pageNumber =
                        totalPages <= 5
                          ? index + 1
                          : page <= 3
                            ? index + 1
                            : page >= totalPages - 2
                              ? totalPages - 4 + index
                              : page - 2 + index;

                      return (
                        <Button
                          key={pageNumber}
                          variant={pageNumber === page ? "default" : "ghost"}
                          size="sm"
                          className={`h-8 w-8 p-0 ${pageNumber === page ? "pointer-events-none" : ""}`}
                          onClick={() => {
                            triggerHaptic("light");
                            updateFilters({ page: String(pageNumber) }, { preservePage: true });
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          {pageNumber}
                        </Button>
                      );
                    })}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    disabled={page >= totalPages}
                    onClick={() => {
                      triggerHaptic("light");
                      updateFilters({ page: String(page + 1) }, { preservePage: true });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Featured Hero Card ─────────────────────────────────── */
function FeaturedHeroCard({
  promotion,
  businessName,
}: {
  promotion: PromotionRow;
  businessName?: string;
}) {
  const imageUrl = promotion.photos?.[0] || promotion.videos?.[0];
  const normalizedImage = imageUrl ? normalizeMediaUrl(imageUrl) : undefined;

  return (
    <Link href={`/promotion/${promotion.id}`} className="group block">
      <div className="relative rounded-2xl overflow-hidden bg-warm-100 dark:bg-warm-800 aspect-[21/9] sm:aspect-[3/1]">
        {normalizedImage && (
          <Image
            src={normalizedImage}
            alt={promotion.title}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            sizes="100vw"
            priority
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        <div className="absolute inset-0 flex items-center p-6 sm:p-8">
          <div className="max-w-lg space-y-2 sm:space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className="bg-brand-gold text-amber-950 text-xs shadow-sm">Featured</Badge>
              <Badge
                className={`text-xs ${
                  promotion.promotion_type === "deal"
                    ? "bg-red-100 text-red-800"
                    : promotion.promotion_type === "event"
                      ? "bg-purple-100 text-purple-800"
                      : promotion.promotion_type === "service"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {PROMOTION_TYPE_LABELS[promotion.promotion_type]}
              </Badge>
            </div>
            <h2 className="font-display text-xl sm:text-2xl md:text-3xl font-bold text-white line-clamp-2 drop-shadow-lg">
              {promotion.title}
            </h2>
            {promotion.price_cents != null && promotion.price_cents > 0 && (
              <p className="text-lg sm:text-xl font-bold text-white drop-shadow-md">
                {formatZAR(promotion.price_cents)}
              </p>
            )}
            {businessName && <p className="text-sm text-white/80">by {businessName}</p>}
            <div className="flex items-center gap-3 text-sm text-white/70">
              <span className="flex items-center gap-1">
                <Megaphone className="h-3.5 w-3.5" />
                {promotion.location_city}, {promotion.location_province}
              </span>
              {promotion.view_count > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" />
                  {promotion.view_count} views
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
