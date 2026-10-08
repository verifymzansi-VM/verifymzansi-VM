"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { feedSourceAttribute } from "@/lib/feed/session";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, TreePalm, CalendarDays, LayoutGrid } from "lucide-react";
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
import { GridStateMessage } from "@/components/listings/grid-state-message";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { parsePromotionFilterType, type PromotionFilterType } from "@/lib/promotions/type-taxonomy";
import {
  type BusinessCategory,
  type PromotionEventState,
  type PromotionType,
  type TrustLevel,
} from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { triggerHaptic } from "@/lib/utils/haptics";
import { cn } from "@/lib/utils";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("PromotionsExplorer");

type ActiveTab = "all" | "tourism" | "events";

const TAB_ORDER: ActiveTab[] = ["all", "tourism", "events"];

// The mixed view loads half a page from each feed so one page stays 24 cards.
const MIXED_FEED_LIMIT = 12;

interface PromotionRow {
  id: string;
  account_profile: Pick<AccountProfileSummary, "display_name" | "trust"> | null;
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

function sourceFor(
  api: "/api/businesses" | "/api/promotions",
  label: string,
  params: URLSearchParams,
  total: number | undefined
) {
  const sourceParams = new URLSearchParams(params);
  const page = Number(sourceParams.get("page")) || 1;
  sourceParams.delete("page");
  sourceParams.delete("limit");
  return feedSourceAttribute({
    kind: "list",
    label,
    api,
    params: sourceParams.toString(),
    page,
    pageSize: 24,
    total,
  });
}

export function PromotionsExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const currentSearchParams = useMemo(() => new URLSearchParams(searchParamKey), [searchParamKey]);

  /* ── Active tab ── */
  // No tab in the URL is the landing view: tourism and events mixed together.
  const activeTab: ActiveTab =
    currentSearchParams.get("tab") === "events" || currentSearchParams.get("type") === "event"
      ? "events"
      : currentSearchParams.get("tab") === "tourism"
        ? "tourism"
        : "all";
  const createHref =
    activeTab === "events" ? "/post/create-tourism?type=event" : "/post/create-tourism";
  const createLabel = activeTab === "events" ? "List an event" : "List a stay or place";

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
  const [reloadToken, setReloadToken] = useState(0);
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
        PromotionEventState | undefined,
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
        tab: activeTab === "all" ? undefined : activeTab,
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
  const clearQueryFilter = () => {
    updateFilters({ q: undefined });
  };

  const clearAllFilters = () => {
    const params = new URLSearchParams();
    if (activeTab !== "all") params.set("tab", activeTab);
    if (activeTab === "events") params.set("type", "event");
    const nextKey = params.toString();
    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
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
      if (tab !== "all") next.set("tab", tab);
      if (tab === "events") next.set("type", "event");
      if (filters.province) next.set("province", filters.province);
      if (filters.city) next.set("city", filters.city);
      const nextKey = next.toString();
      router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
    },
    [filters.province, filters.city, pathname, router]
  );

  /* ── Tabs keyboard support (roving tabindex, arrow keys) ── */
  const tabRefs = useRef<Partial<Record<ActiveTab, HTMLButtonElement | null>>>({});
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TAB_ORDER.indexOf(activeTab);
    let target: ActiveTab | null = null;
    if (event.key === "ArrowRight") {
      target = TAB_ORDER[(index + 1) % TAB_ORDER.length];
    } else if (event.key === "ArrowLeft") {
      target = TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length];
    } else if (event.key === "Home") {
      target = TAB_ORDER[0];
    } else if (event.key === "End") {
      target = TAB_ORDER[TAB_ORDER.length - 1];
    }
    if (!target) return;
    event.preventDefault();
    tabRefs.current[target]?.focus();
    if (target !== activeTab) switchTab(target);
  };

  // Lets the desktop post viewer continue through this exact list and page.
  const [feedSource, setFeedSource] = useState<string | null>(null);

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
        params.set("limit", activeTab === "all" ? String(MIXED_FEED_LIMIT) : "24");

        const tourismParams = new URLSearchParams(params);
        tourismParams.set("category", "tourism_hospitality");
        if (activeTab === "tourism" && filters.subcategory) {
          tourismParams.set("subcategory", filters.subcategory);
        }

        const eventParams = new URLSearchParams(params);
        eventParams.set("type", "event");
        if (activeTab === "events") {
          if (filters.eventType) eventParams.set("event_type", filters.eventType);
          if (filters.eventState) eventParams.set("event_state", filters.eventState);
        }

        // A non-JSON error page (e.g. a 502) must not surface as a parser error.
        const loadTourism = async () => {
          const res = await fetch(`/api/businesses?${tourismParams.toString()}`, {
            cache: "no-store",
          });
          const payload = (await res.json().catch(() => ({}))) as BusinessesResponse;
          return { ok: res.ok, payload };
        };
        const loadEvents = async () => {
          const res = await fetch(`/api/promotions?${eventParams.toString()}`, {
            cache: "no-store",
          });
          const payload = (await res.json().catch(() => ({}))) as PromotionsResponse;
          return { ok: res.ok, payload };
        };

        const [tourismResult, eventsResult] = await Promise.all([
          activeTab === "events" ? null : loadTourism(),
          activeTab === "tourism" ? null : loadEvents(),
        ]);

        if (!active) return;

        setTourismResponse(
          tourismResult?.ok
            ? tourismResult.payload
            : { businesses: [], total: 0, page: 1, limit: 24 }
        );
        setEventsResponse(
          eventsResult?.ok
            ? eventsResult.payload
            : {
                promotions: [],
                accountProfiles: [],
                sellers: [],
                businesses: [],
                total: 0,
                page: 1,
                limit: 24,
              }
        );
        if (tourismResult && !tourismResult.ok) {
          setError(tourismResult.payload.error || "Failed to load tourism businesses.");
        } else if (eventsResult && !eventsResult.ok) {
          setError(eventsResult.payload.error || "Failed to load events.");
        }

        // The post viewer continues through one feed, so the mixed view has no source.
        if (activeTab === "tourism" && tourismResult?.ok) {
          setFeedSource(
            sourceFor(
              "/api/businesses",
              "Tourism stays and places",
              tourismParams,
              tourismResult.payload.total
            )
          );
        } else if (activeTab === "events" && eventsResult?.ok) {
          setFeedSource(
            sourceFor("/api/promotions", "Events", eventParams, eventsResult.payload.total)
          );
        } else {
          setFeedSource(null);
        }

        setLoading(false);
      } catch (loadError) {
        if (!active) return;
        log.error("Tourism & Events fetch threw", {
          message: loadError instanceof Error ? loadError.message : String(loadError),
        });
        setError("We couldn't load this right now. Please check your connection and try again.");
        setLoading(false);
      }
    }

    void loadData();

    return () => {
      active = false;
    };
  }, [activeTab, filters, reloadToken]);

  /* ── Events data maps ── */
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
  const tourismTotal = activeTab === "events" ? 0 : (tourismResponse.total ?? 0);
  const eventsTotal = activeTab === "tourism" ? 0 : (eventsResponse.total ?? 0);
  const total = tourismTotal + eventsTotal;
  const page =
    (activeTab === "events" ? eventsResponse.page : tourismResponse.page) ?? filters.page;
  const pagesFor = (count: number, limit: number | undefined) => Math.ceil(count / (limit ?? 24));
  const totalPages = Math.max(
    1,
    pagesFor(tourismTotal, tourismResponse.limit),
    pagesFor(eventsTotal, eventsResponse.limit)
  );

  /* ── Tourism data ── */
  const tourismBusinesses = activeTab === "events" ? [] : (tourismResponse.businesses ?? []);

  /* ── Events data ── */
  const promotions = activeTab === "tourism" ? [] : (eventsResponse.promotions ?? []);
  const now = new Date();

  /* ── Grid items: the mixed view alternates a stay/place with an event ── */
  const gridItems: Array<
    { kind: "tourism"; business: BusinessRow } | { kind: "event"; promotion: PromotionRow }
  > = [];
  for (let i = 0; i < Math.max(tourismBusinesses.length, promotions.length); i++) {
    if (i < tourismBusinesses.length) {
      gridItems.push({ kind: "tourism", business: tourismBusinesses[i] });
    }
    if (i < promotions.length) gridItems.push({ kind: "event", promotion: promotions[i] });
  }
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
    onBusinessClear: () => updateFilters({ business_id: undefined }),
  };

  // The grid is rendered only when it has results, so aria-controls must never
  // point at a panel that is not in the DOM.
  const activePanelRendered = !loading && !error && gridItems.length > 0;
  const panelId = `tab-panel-${activeTab}`;

  const tabBaseClasses =
    "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  const allTabActiveClasses =
    "border-primary/40 bg-primary/10 text-brand-green-800 dark:border-primary/60 dark:bg-primary/20 dark:text-brand-green-200";
  const tourismTabActiveClasses =
    "border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-200";
  const inactiveTabClasses = "border-transparent text-muted-foreground hover:bg-muted/60";
  const eventTabActiveClasses =
    "border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/30 hover:bg-amber-600 dark:border-amber-400 dark:bg-amber-400 dark:text-amber-950";
  const eventTabInactiveClasses =
    "border-amber-300 bg-amber-50 text-amber-800 shadow-sm shadow-amber-200/70 hover:border-amber-400 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-500/70 dark:bg-amber-500/15 dark:text-amber-200 dark:shadow-none dark:hover:bg-amber-500/25";
  const tabClasses = (tab: ActiveTab, selected: boolean) => {
    if (tab === "events") return selected ? eventTabActiveClasses : eventTabInactiveClasses;
    if (!selected) return inactiveTabClasses;
    return tab === "all" ? allTabActiveClasses : tourismTabActiveClasses;
  };
  const tabIcons = { all: LayoutGrid, tourism: TreePalm, events: CalendarDays } as const;
  const tabLabels = { all: "All", tourism: "Tourism", events: "Events" } as const;

  const loadingLabel =
    activeTab === "all"
      ? "Loading stays, places and events…"
      : activeTab === "tourism"
        ? "Loading stays and places…"
        : "Loading events…";
  const resultNoun =
    activeTab === "all"
      ? `listing${total === 1 ? "" : "s"}`
      : activeTab === "tourism"
        ? `tourism business${total === 1 ? "" : "es"}`
        : `event${total === 1 ? "" : "s"}`;
  const EmptyIcon = activeTab === "events" ? CalendarDays : TreePalm;

  return (
    <div className="container-page py-8 space-y-7 lg:py-10">
      <AnalyticsImpressions
        items={promotions.map((promotion) => ({ table: "promotions" as const, id: promotion.id }))}
        surface="tourism_list"
      />
      <PageHeader
        title="Tourism & Events"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Tourism & Events" }]}
      >
        <Button asChild size="sm" className="h-11 gap-1 elev-xs hover:elev-sm">
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
        className="flex items-center gap-1.5 rounded-[1.25rem] border border-border/70 bg-background/95 p-1.5 elev-sm"
      >
        {TAB_ORDER.map((tab) => {
          const selected = tab === activeTab;
          const Icon = tabIcons[tab];
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              onKeyDown={handleTabKeyDown}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              ref={(node) => {
                tabRefs.current[tab] = node;
              }}
              id={`tab-${tab}`}
              aria-controls={selected && activePanelRendered ? panelId : undefined}
              className={cn(tabBaseClasses, tabClasses(tab, selected))}
              onClick={() => switchTab(tab)}
            >
              <Icon className="h-4 w-4" />
              {tabLabels[tab]}
            </button>
          );
        })}
      </div>

      {/* Mobile filter drawer (FAB visible < lg only) */}
      <PromotionFilterDrawer {...filterPanelProps} />

      <div className="lg:flex lg:gap-8">
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-24 space-y-4">
            <PromotionFilterPanel {...filterPanelProps} />
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-6">
          {/* ── Results Count ── */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
              {loading ? (
                loadingLabel
              ) : (
                <>
                  <span className="font-medium text-foreground">{total}</span> {resultNoun} found
                </>
              )}
            </p>
          </div>

          {/* ── Grid / Loading / Error / Empty ── */}
          {loading ? (
            <div data-testid="promotions-grid-loading">
              <ListingGridSkeleton />
            </div>
          ) : error ? (
            <GridStateMessage
              tone="teal"
              state="error"
              title={
                activeTab === "all"
                  ? "Unable to load tourism and events"
                  : activeTab === "tourism"
                    ? "Unable to load tourism businesses"
                    : "Unable to load events"
              }
              body={error}
              icon={<TreePalm className="h-7 w-7 text-teal-600 dark:text-teal-300" />}
              testId="promotions-grid-empty"
            >
              <Button variant="outline" onClick={() => setReloadToken((token) => token + 1)}>
                Retry
              </Button>
            </GridStateMessage>
          ) : gridItems.length === 0 ? (
            <GridStateMessage
              tone="teal"
              state="filtered-empty"
              title={
                activeTab === "all"
                  ? "Nothing matches your filters"
                  : activeTab === "tourism"
                    ? "No tourism businesses match your filters"
                    : "No events match your filters"
              }
              body="Try broadening the filters or clearing a location filter."
              icon={<EmptyIcon className="h-7 w-7 text-teal-600 dark:text-teal-300" />}
              testId="promotions-grid-empty"
            >
              <Button asChild size="sm" className="h-11 gap-1">
                <Link href={createHref}>
                  {createLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="h-11" onClick={clearAllFilters}>
                Clear all filters
              </Button>
            </GridStateMessage>
          ) : (
            <>
              <div
                id={panelId}
                role="tabpanel"
                data-feed-source={feedSource ?? undefined}
                aria-labelledby={`tab-${activeTab}`}
                className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6"
              >
                {gridItems.map((item, index) => {
                  if (item.kind === "tourism") {
                    return (
                      <BusinessCardGridItem
                        key={`tourism-${item.business.id}`}
                        business={item.business}
                        index={index}
                      />
                    );
                  }

                  const promotion = item.promotion;
                  const accountProfile = promotion.account_profile;
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
                      key={`event-${promotion.id}`}
                      className="content-auto motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-both [animation-duration:400ms] sm:slide-in-from-bottom-2"
                      style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}
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
