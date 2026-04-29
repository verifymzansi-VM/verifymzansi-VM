"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, TreePalm, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/layout";
import {
  BusinessCardGridItem,
  type BusinessCardGridRow,
} from "@/components/listings/business-card-grid-item";
import { MarketplacePaginationControls } from "@/components/listings/marketplace-pagination-controls";
import { PromotionCard } from "@/components/listings/promotion-card";
import { PromotionFilterPanel } from "@/components/listings/promotion-filter-panel";
import { PromotionFilterDrawer } from "@/components/listings/promotion-filter-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { parsePromotionFilterType, type PromotionFilterType } from "@/lib/promotions/type-taxonomy";
import {
  type BusinessCategory,
  type PromotionEventState,
  type PromotionType,
  type TrustLevel,
} from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { triggerHaptic } from "@/lib/utils/haptics";
import { cn } from "@/lib/utils";

type ActiveTab = "tourism" | "events";

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
  like_count?: number | null;
  viewer_has_liked?: boolean;
  focal_x: number | null;
  focal_y: number | null;
  media_width: number | null;
  media_height: number | null;
  logo_url: string | null;
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

interface BusinessRow extends BusinessCardGridRow {
  owner_id: string;
  like_count?: number | null;
  viewer_has_liked?: boolean;
}

interface BusinessesResponse {
  businesses?: BusinessRow[];
  total?: number;
  page?: number;
  limit?: number;
  error?: string;
}

function normalizeValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function PromotionsExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const currentSearchParams = useMemo(() => new URLSearchParams(searchParamKey), [searchParamKey]);

  /* ── Active tab ── */
  const activeTab: ActiveTab = currentSearchParams.get("tab") === "events" ? "events" : "tourism";
  const createHref =
    activeTab === "events" ? "/post/create-tourism?type=event" : "/post/create-tourism";
  const createLabel = activeTab === "events" ? "Create Event" : "List Tourism Business";

  /* ── Events state ── */
  const [eventsResponse, setEventsResponse] = useState<PromotionsResponse>({
    promotions: [],
    accountProfiles: [],
    sellers: [],
    businesses: [],
    total: 0,
    page: 1,
    limit: 24,
  });

  /* ── Tourism state ── */
  const [tourismResponse, setTourismResponse] = useState<BusinessesResponse>({
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
      type: parsePromotionFilterType(currentSearchParams.get("type")) ?? undefined,
      category: normalizeValue(currentSearchParams.get("category")) as BusinessCategory | undefined,
      province: normalizeValue(currentSearchParams.get("province")),
      city: normalizeValue(currentSearchParams.get("city")),
      businessId: normalizeValue(currentSearchParams.get("business_id")),
      eventState: normalizeValue(currentSearchParams.get("event_state")) as
        | PromotionEventState
        | undefined,
      subcategory: normalizeValue(currentSearchParams.get("subcategory")),
      eventType: normalizeValue(currentSearchParams.get("event_type")),
      page: Math.max(1, parseInt(currentSearchParams.get("page") || "1", 10)),
    }),
    [currentSearchParams]
  );

  const updateFilters = useCallback(
    (updates: Record<string, string | undefined>, options?: { preservePage?: boolean }) => {
      const next = new URLSearchParams();
      const nextFilters = {
        tab: activeTab,
        q: filters.query,
        type: filters.type,
        category: filters.category,
        province: filters.province,
        city: filters.city,
        business_id: filters.businessId,
        event_state: filters.eventState,
        subcategory: filters.subcategory,
        event_type: filters.eventType,
        page: options?.preservePage ? String(filters.page) : undefined,
        ...updates,
      };

      for (const [key, value] of Object.entries(nextFilters)) {
        if (value === undefined || value === "") {
          continue;
        }
        next.set(key, value);
      }

      if (!options?.preservePage) {
        next.delete("page");
      }

      const nextKey = next.toString();
      router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
    },
    [activeTab, filters, pathname, router]
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
    const params = new URLSearchParams();
    params.set("tab", activeTab);
    if (activeTab === "events") params.set("type", "event");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleTypeChange = useCallback(
    (value: PromotionFilterType | undefined) => {
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

  const handleSubcategoryChange = useCallback(
    (value: string | undefined) => {
      updateFilters({ subcategory: value });
    },
    [updateFilters]
  );

  const handleEventTypeChange = useCallback(
    (value: string | undefined) => {
      updateFilters({ event_type: value });
    },
    [updateFilters]
  );

  const switchTab = useCallback(
    (tab: ActiveTab) => {
      // Reset filters when switching tabs, but keep location filters
      const next = new URLSearchParams();
      next.set("tab", tab);
      if (tab === "events") next.set("type", "event");
      if (filters.province) next.set("province", filters.province);
      if (filters.city) next.set("city", filters.city);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [filters.province, filters.city, pathname, router]
  );

  /* ── Data fetching ── */
  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (filters.query) params.set("q", filters.query);
        if (filters.province) params.set("province", filters.province);
        if (filters.city) params.set("city", filters.city);
        params.set("page", String(filters.page));
        params.set("limit", "24");

        if (activeTab === "tourism") {
          params.set("category", "tourism_hospitality");
          if (filters.subcategory) params.set("subcategory", filters.subcategory);

          const res = await fetch(`/api/businesses?${params.toString()}`, { cache: "no-store" });
          const payload = (await res.json()) as BusinessesResponse;

          if (!active) return;
          if (!res.ok) {
            setError(payload.error || "Failed to load tourism businesses.");
            setTourismResponse({ businesses: [], total: 0, page: 1, limit: 24 });
          } else {
            setTourismResponse(payload);
          }
        } else {
          params.set("type", "event");
          if (filters.eventType) params.set("event_type", filters.eventType);
          if (filters.eventState) params.set("event_state", filters.eventState);

          const res = await fetch(`/api/promotions?${params.toString()}`, { cache: "no-store" });
          const payload = (await res.json()) as PromotionsResponse;

          if (!active) return;
          if (!res.ok) {
            setError(payload.error || "Failed to load events.");
            setEventsResponse({
              promotions: [],
              accountProfiles: [],
              sellers: [],
              businesses: [],
              total: 0,
              page: 1,
              limit: 24,
            });
          } else {
            setEventsResponse(payload);
          }
        }

        setLoading(false);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load data.");
        setLoading(false);
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [activeTab, filters]);

  /* ── Events data maps ── */
  const accountProfileMap = useMemo(
    () =>
      new Map(
        (eventsResponse.accountProfiles ?? eventsResponse.sellers ?? []).map((accountProfile) => [
          accountProfile.user_id,
          accountProfile,
        ])
      ),
    [eventsResponse.accountProfiles, eventsResponse.sellers]
  );
  const businessMap = useMemo(
    () =>
      new Map(
        (eventsResponse.businesses ?? []).map((business) => [business.id, business.business_name])
      ),
    [eventsResponse.businesses]
  );
  const businessLogoMap = useMemo(
    () =>
      new Map(
        (eventsResponse.businesses ?? []).map((business) => [
          business.id,
          business.logo_url as string | null,
        ])
      ),
    [eventsResponse.businesses]
  );

  /* ── Pagination ── */
  const currentResponse = activeTab === "tourism" ? tourismResponse : eventsResponse;
  const total = currentResponse.total ?? 0;
  const page = currentResponse.page ?? filters.page;
  const limit = currentResponse.limit ?? 24;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  /* ── Tourism data ── */
  const tourismBusinesses = tourismResponse.businesses ?? [];

  /* ── Events data ── */
  const promotions = eventsResponse.promotions ?? [];
  const now = new Date();
  const filterPanelProps = {
    filters,
    activeTab,
    cities,
    businessMap,
    onTypeChange: handleTypeChange,
    onCategoryChange: (value: string | undefined) => updateFilters({ category: value }),
    onSubcategoryChange: handleSubcategoryChange,
    onEventTypeChange: handleEventTypeChange,
    onProvinceChange: handleProvinceChange,
    onCityChange: (value: string | undefined) => updateFilters({ city: value }),
    onEventStateChange: handleEventStateChange,
    onClearQuery: clearQueryFilter,
    onClearAll: clearAllFilters,
  };

  return (
    <div className="container-page py-8 space-y-6">
      <PageHeader
        title="Tourism & Events"
        description="Tourism destinations, accommodations, and events from South African hosts, businesses, and members."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Tourism & Events" }]}
      >
        <Button asChild size="sm" className="h-11 gap-1">
          <Link href={createHref}>
            {createLabel}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </PageHeader>

      {/* ── Tab Switcher ── */}
      <div
        role="tablist"
        aria-label="Tourism & Events sections"
        className="flex items-center gap-1.5 rounded-[1.25rem] border border-border/70 bg-background/95 p-1.5 shadow-sm"
      >
        {activeTab === "tourism" ? (
          <button
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="tab-panel-tourism"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200"
            )}
            onClick={() => switchTab("tourism")}
          >
            <TreePalm className="h-4 w-4" />
            Tourism
          </button>
        ) : (
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="tab-panel-tourism"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "border-transparent text-muted-foreground hover:bg-muted/60"
            )}
            onClick={() => switchTab("tourism")}
          >
            <TreePalm className="h-4 w-4" />
            Tourism
          </button>
        )}

        {activeTab === "events" ? (
          <button
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="tab-panel-events"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200"
            )}
            onClick={() => switchTab("events")}
          >
            <CalendarDays className="h-4 w-4" />
            Events
          </button>
        ) : (
          <button
            type="button"
            role="tab"
            aria-selected="false"
            aria-controls="tab-panel-events"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "border-transparent text-muted-foreground hover:bg-muted/60"
            )}
            onClick={() => switchTab("events")}
          >
            <CalendarDays className="h-4 w-4" />
            Events
          </button>
        )}
      </div>

      {/* Mobile filter drawer (FAB visible < lg only) */}
      <PromotionFilterDrawer {...filterPanelProps} />

      <div className="lg:flex lg:gap-6">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-24 space-y-4">
            <PromotionFilterPanel {...filterPanelProps} />
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          {/* ── Results Count + CTA ── */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
              {loading ? (
                activeTab === "tourism" ? (
                  "Loading tourism businesses..."
                ) : (
                  "Loading events..."
                )
              ) : (
                <>
                  <span className="font-medium text-foreground">{total}</span>{" "}
                  {activeTab === "tourism"
                    ? `tourism business${total === 1 ? "" : "es"}`
                    : `event${total === 1 ? "" : "s"}`}{" "}
                  found
                </>
              )}
            </p>
            <Button asChild variant="outline" size="sm" className="h-11 gap-1">
              <Link href={createHref}>
                {createLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* ── Grid / Loading / Error / Empty ── */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="aspect-[9/16] rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                <TreePalm className="mx-auto h-8 w-8 text-muted-foreground" />
                <h3 className="font-display text-lg font-semibold">
                  {activeTab === "tourism"
                    ? "Unable to load tourism businesses"
                    : "Unable to load events"}
                </h3>
                <p className="text-sm text-muted-foreground">{error}</p>
              </CardContent>
            </Card>
          ) : (
              activeTab === "tourism" ? tourismBusinesses.length === 0 : promotions.length === 0
            ) ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-center">
                {activeTab === "tourism" ? (
                  <TreePalm className="mx-auto h-8 w-8 text-muted-foreground" />
                ) : (
                  <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
                )}
                <h3 className="font-display text-lg font-semibold">
                  {activeTab === "tourism"
                    ? "No tourism businesses match your filters"
                    : "No events match your filters"}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Try broadening the filters, clearing a location filter, or publishing a new
                  {activeTab === "tourism" ? " tourism business" : " event"}.
                </p>
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                  <Button asChild size="sm" className="h-11 gap-1">
                    <Link href={createHref}>
                      {createLabel}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" className="h-11" onClick={clearAllFilters}>
                    Clear all filters
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : activeTab === "tourism" ? (
            /* ── Tourism Grid ── */
            <>
              <div
                id="tab-panel-tourism"
                role="tabpanel"
                aria-labelledby="tab-tourism"
                className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6"
              >
                {tourismBusinesses.map((business, index) => (
                  <BusinessCardGridItem key={business.id} business={business} index={index} />
                ))}
              </div>

              {totalPages > 1 && (
                <MarketplacePaginationControls
                  page={page}
                  totalPages={totalPages}
                  onPageChange={(p) => {
                    triggerHaptic("light");
                    updateFilters({ page: String(p) }, { preservePage: true });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              )}
            </>
          ) : (
            /* ── Events Grid ── */
            <>
              <div
                id="tab-panel-events"
                role="tabpanel"
                aria-labelledby="tab-events"
                className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6"
              >
                {promotions.map((promotion, index) => {
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
                      className={`content-auto animate-in fade-in fill-mode-both [animation-duration:400ms] sm:slide-in-from-bottom-2 [animation-delay:${Math.min(index * 50, 400)}ms]`}
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
                        logoUrl={promotion.logo_url || businessLogo}
                        focalX={promotion.focal_x}
                        focalY={promotion.focal_y}
                        mediaWidth={promotion.media_width}
                        mediaHeight={promotion.media_height}
                      />
                    </div>
                  );
                })}
              </div>

              {totalPages > 1 && (
                <MarketplacePaginationControls
                  page={page}
                  totalPages={totalPages}
                  onPageChange={(p) => {
                    triggerHaptic("light");
                    updateFilters({ page: String(p) }, { preservePage: true });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
