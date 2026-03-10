"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Calendar,
  Eye,
  Megaphone,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PromotionCard } from "@/components/listings/promotion-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import {
  PROMOTION_EVENT_STATE_LABELS,
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

interface PromotionRow {
  id: string;
  seller_id: string;
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

interface SellerSummary {
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
  sellers?: SellerSummary[];
  businesses?: BusinessSummary[];
  total?: number;
  page?: number;
  limit?: number;
  error?: string;
}

function normalizeValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const TYPE_TAB_OPTIONS: { value: string; label: string; activeClass: string }[] = [
  { value: "", label: "All", activeClass: "bg-foreground text-background" },
  {
    value: "deal",
    label: "Deals",
    activeClass: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  {
    value: "product",
    label: "Products",
    activeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  {
    value: "service",
    label: "Services",
    activeClass: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  },
  {
    value: "event",
    label: "Events",
    activeClass: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  },
  {
    value: "general",
    label: "Ads",
    activeClass: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  },
];

export function PromotionsExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const currentSearchParams = useMemo(() => new URLSearchParams(searchParamKey), [searchParamKey]);
  const [response, setResponse] = useState<PromotionsResponse>({
    promotions: [],
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

  const sellerMap = useMemo(
    () => new Map((response.sellers ?? []).map((seller) => [seller.user_id, seller])),
    [response.sellers]
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

  const activeFilterCount = [
    filters.query,
    filters.category,
    filters.province,
    filters.city,
    filters.businessId,
    filters.eventState,
  ].filter(Boolean).length;

  const selectClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <div className="container mx-auto px-4 py-6 space-y-5 max-w-7xl">
      <PageHeader
        title="Promotions & Events"
        description="Deals, promotions, launches, and events from verified South African sellers."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Promotions & Events" }]}
      />

      {/* ── Type Tabs (horizontal scroll on mobile) ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap">
        {TYPE_TAB_OPTIONS.map((tab) => {
          const isActive = (filters.type || "") === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              className={`shrink-0 inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-all border ${
                isActive
                  ? `${tab.activeClass} border-transparent shadow-sm`
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              onClick={() => {
                updateFilters({
                  type: tab.value || undefined,
                  event_state: tab.value && tab.value !== "event" ? undefined : filters.eventState,
                });
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Featured Hero Card ── */}
      {featuredPromotion && !loading && (
        <FeaturedHeroCard
          promotion={featuredPromotion}
          seller={sellerMap.get(featuredPromotion.seller_id)}
          businessName={
            featuredPromotion.business_id
              ? businessMap.get(featuredPromotion.business_id)
              : undefined
          }
        />
      )}

      {/* ── Desktop Filters ── */}
      <section className="hidden sm:block space-y-4 rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
          <div className="space-y-1.5">
            <Label htmlFor="promotion-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                key={filters.query ?? ""}
                id="promotion-search"
                type="search"
                placeholder="Search promotions, deals, or events"
                className="pl-9"
                defaultValue={filters.query ?? ""}
                onChange={(event) => {
                  debouncedUpdateQuery(event.target.value);
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promotion-category">Category</Label>
            <select
              id="promotion-category"
              aria-label="Promotion category"
              className={selectClass}
              value={filters.category || ""}
              onChange={(event) => updateFilters({ category: normalizeValue(event.target.value) })}
            >
              <option value="">All categories</option>
              {BUSINESS_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promotion-province">Province</Label>
            <select
              id="promotion-province"
              aria-label="Province"
              className={selectClass}
              value={filters.province || ""}
              onChange={(event) =>
                updateFilters({
                  province: normalizeValue(event.target.value),
                  city: undefined,
                })
              }
            >
              <option value="">All provinces</option>
              {getProvinceNames().map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promotion-city">City</Label>
            <select
              id="promotion-city"
              aria-label="City"
              className={selectClass}
              value={filters.city || ""}
              onChange={(event) => updateFilters({ city: normalizeValue(event.target.value) })}
              disabled={!filters.province}
            >
              <option value="">All cities</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filters.type === "event" && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-1.5">
              <Label htmlFor="promotion-event-state">Event state</Label>
              <select
                id="promotion-event-state"
                aria-label="Event state"
                className={selectClass}
                value={filters.eventState || ""}
                onChange={(event) => {
                  const nextEventState = normalizeValue(event.target.value);
                  updateFilters({
                    type: nextEventState ? "event" : filters.type,
                    event_state: nextEventState,
                  });
                }}
              >
                <option value="">All event states</option>
                {Object.entries(PROMOTION_EVENT_STATE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div />
          </div>
        )}

        {/* Active filter chips */}
        {(filters.query ||
          filters.category ||
          filters.province ||
          filters.city ||
          filters.businessId ||
          filters.eventState) && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.query && (
              <Badge variant="secondary" className="gap-1">
                {filters.query}
                <button
                  type="button"
                  className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove query filter ${filters.query}`}
                  onClick={clearQueryFilter}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {filters.category && (
              <Badge variant="secondary" className="gap-1">
                {BUSINESS_CATEGORIES.find((category) => category.value === filters.category)?.label}
                <button
                  type="button"
                  className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove promotion category filter"
                  onClick={() => updateFilters({ category: undefined })}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {filters.province && (
              <Badge variant="secondary" className="gap-1">
                {filters.province}
                {filters.city && `, ${filters.city}`}
                <button
                  type="button"
                  className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove promotion location filter"
                  onClick={() => updateFilters({ province: undefined, city: undefined })}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {filters.businessId && (
              <Badge variant="secondary" className="gap-1">
                <Building2 className="h-3 w-3" />
                {businessMap.get(filters.businessId) || "Linked business"}
                <button
                  type="button"
                  className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove linked business filter"
                  onClick={() => updateFilters({ business_id: undefined })}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
            {filters.eventState && (
              <Badge variant="secondary" className="gap-1">
                <Calendar className="h-3 w-3" />
                {PROMOTION_EVENT_STATE_LABELS[filters.eventState]}
                <button
                  type="button"
                  className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove event state filter"
                  onClick={() => updateFilters({ event_state: undefined })}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={clearAllFilters}
            >
              Clear all
            </Button>
          </div>
        )}
      </section>

      {/* ── Mobile Filter FAB + Sheet ── */}
      <Sheet>
        <div className="fixed bottom-20 right-4 z-40 sm:hidden">
          <SheetTrigger asChild>
            <Button
              size="lg"
              className="rounded-full shadow-lg h-14 w-14 bg-red-500 hover:bg-red-600 relative"
            >
              <SlidersHorizontal className="h-5 w-5" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background text-[10px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
        </div>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-24">
          <SheetHeader>
            <SheetTitle>Filter Promotions</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-4">
            <div className="space-y-1.5">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search promotions..."
                  className="pl-9"
                  defaultValue={filters.query ?? ""}
                  onChange={(e) => debouncedUpdateQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <select
                className={selectClass}
                value={filters.category || ""}
                onChange={(e) => updateFilters({ category: normalizeValue(e.target.value) })}
              >
                <option value="">All categories</option>
                {BUSINESS_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Province</Label>
                <select
                  className={selectClass}
                  value={filters.province || ""}
                  onChange={(e) =>
                    updateFilters({
                      province: normalizeValue(e.target.value),
                      city: undefined,
                    })
                  }
                >
                  <option value="">All</option>
                  {getProvinceNames().map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>City</Label>
                <select
                  className={selectClass}
                  value={filters.city || ""}
                  onChange={(e) => updateFilters({ city: normalizeValue(e.target.value) })}
                  disabled={!filters.province}
                >
                  <option value="">All</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {filters.type === "event" && (
              <div className="space-y-1.5">
                <Label>Event state</Label>
                <select
                  className={selectClass}
                  value={filters.eventState || ""}
                  onChange={(e) => updateFilters({ event_state: normalizeValue(e.target.value) })}
                >
                  <option value="">All states</option>
                  {Object.entries(PROMOTION_EVENT_STATE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="fixed bottom-0 inset-x-0 p-4 bg-background border-t flex gap-3">
            <Button variant="outline" className="flex-1" onClick={clearAllFilters}>
              Clear all
            </Button>
            <SheetClose asChild>
              <Button className="flex-1">Show results</Button>
            </SheetClose>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Results Count + CTA ── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
          <span className="font-medium text-foreground">{total}</span> promotion
          {total === 1 ? "" : "s"} found
        </p>
        <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex gap-1">
          <Link href="/post/create">
            Start Advertising
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
            <h3 className="font-display text-lg font-semibold">Unable to load promotions</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      ) : gridPromotions.length === 0 && !featuredPromotion ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="font-display text-lg font-semibold">No promotions match your filters</h3>
            <p className="text-sm text-muted-foreground">
              Try broadening the search, changing the category, or clearing a location filter.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {gridPromotions.map((promotion, index) => {
              const seller = sellerMap.get(promotion.seller_id);
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
                    sellerTrustLevel={seller?.trust}
                    sellerName={seller?.display_name}
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
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => updateFilters({ page: String(page - 1) }, { preservePage: true })}
              >
                Previous
              </Button>

              <div className="flex items-center gap-1">
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
                      onClick={() =>
                        updateFilters({ page: String(pageNumber) }, { preservePage: true })
                      }
                    >
                      {pageNumber}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => updateFilters({ page: String(page + 1) }, { preservePage: true })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Featured Hero Card ─────────────────────────────────── */
function FeaturedHeroCard({
  promotion,
  seller: _seller,
  businessName,
}: {
  promotion: PromotionRow;
  seller?: SellerSummary;
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
