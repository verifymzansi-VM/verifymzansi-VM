"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Megaphone } from "lucide-react";
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
import { VideoCardPlayer } from "@/components/ui/video-card-player";

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
  logo_url: string | null;
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
          setError(payload.error || "Failed to load promotions.");
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

        setError(loadError instanceof Error ? loadError.message : "Failed to load promotions.");
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
  const businessLogoMap = useMemo(
    () =>
      new Map(
        (response.businesses ?? []).map((business) => [
          business.id,
          business.logo_url as string | null,
        ])
      ),
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
        description="Deals, promotions, launches, and events from verified South African businesses and members."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Promotions & Events" }]}
      >
        <Button asChild size="sm" className="gap-1">
          <Link href="/post/create-promotion">
            Create Promotion
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </PageHeader>

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
              {loading ? (
                "Loading promotions..."
              ) : (
                <>
                  <span className="font-medium text-foreground">{total}</span> promotion
                  {total === 1 ? "" : "s"} found
                </>
              )}
            </p>
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex gap-1">
              <Link href="/post/create-promotion">
                Create Promotion
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* ── Grid / Loading / Error / Empty ── */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="aspect-[9/14] rounded-[1.75rem] bg-muted animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="font-display text-lg font-semibold">Unable to load promotions</h3>
                <p className="text-sm text-muted-foreground">{error}</p>
              </CardContent>
            </Card>
          ) : gridPromotions.length === 0 && !featuredPromotion ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="font-display text-lg font-semibold">
                  No promotions match your filters
                </h3>
                <p className="text-sm text-muted-foreground">
                  Try broadening the search, changing the category, or clearing a location filter.
                </p>
                <Button variant="outline" size="sm" onClick={clearAllFilters}>
                  Clear all filters
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {gridPromotions.map((promotion, index) => {
                  const accountProfile = accountProfileMap.get(promotion.owner_id);
                  const businessName = promotion.business_id
                    ? businessMap.get(promotion.business_id)
                    : undefined;
                  const businessLogo = promotion.business_id
                    ? businessLogoMap.get(promotion.business_id)
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
                        logoUrl={businessLogo}
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
  const mediaUrl = promotion.videos?.[0] || promotion.photos?.[0];
  const posterUrl = promotion.video_thumbnail || promotion.photos?.[0] || undefined;

  return (
    <Link href={`/promotion/${promotion.id}`} className="group block">
      <div className="relative overflow-hidden rounded-[1.75rem] bg-warm-100 dark:bg-warm-800 aspect-[9/12] sm:aspect-[16/7]">
        {mediaUrl ? (
          <VideoCardPlayer
            src={mediaUrl}
            posterUrl={posterUrl}
            alt={promotion.title}
            sizes="100vw"
            mode="ambient"
            priority
            mediaClassName="transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : (
          <Image
            src={normalizeMediaUrl("/images/fallbacks/hero-shop.svg")}
            alt={promotion.title}
            fill
            className="object-cover"
            sizes="100vw"
            priority
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/24 to-black/8" />
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
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
            <div className="flex items-center gap-3 text-sm text-white/70">
              <span className="flex items-center gap-1">
                <Megaphone className="h-3.5 w-3.5" />
                {promotion.location_city}, {promotion.location_province}
              </span>
              {businessName ? <span>by {businessName}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
