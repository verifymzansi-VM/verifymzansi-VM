"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Building2, Calendar, Megaphone, Search, X } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PromotionCard } from "@/components/listings/promotion-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

        const res = await fetch(`/api/promotions?${params.toString()}`, { cache: "no-store" });
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
        setResponse({ promotions: [], sellers: [], businesses: [], total: 0, page: 1, limit: 24 });
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

  return (
    <div className="container mx-auto px-4 py-6 space-y-6 max-w-7xl">
      <PageHeader
        title="Promotions & Events"
        description="Deals, promotions, launches, and events from verified South African sellers."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Promotions & Events" }]}
      />

      <section className="space-y-4 rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
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
            <Label htmlFor="promotion-type">Type</Label>
            <select
              id="promotion-type"
              aria-label="Promotion type"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={filters.type || ""}
              onChange={(event) => {
                const nextType = normalizeValue(event.target.value);
                updateFilters({
                  type: nextType,
                  event_state: nextType && nextType !== "event" ? undefined : filters.eventState,
                });
              }}
            >
              <option value="">All types</option>
              {Object.entries(PROMOTION_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promotion-category">Category</Label>
            <select
              id="promotion-category"
              aria-label="Promotion category"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-1.5">
            <Label htmlFor="promotion-event-state">Event state</Label>
            <select
              id="promotion-event-state"
              aria-label="Event state"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

          <div className="flex items-end">
            <Button asChild className="w-full gap-2">
              <Link href="/post/create">
                Start Advertising
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {(filters.query ||
          filters.type ||
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
            {filters.type && (
              <Badge variant="secondary" className="gap-1">
                {PROMOTION_TYPE_LABELS[filters.type]}
                <button
                  type="button"
                  className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Remove promotion type filter"
                  onClick={() =>
                    updateFilters({
                      type: undefined,
                      event_state: undefined,
                    })
                  }
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
          <span className="font-medium text-foreground">{total}</span> promotion
          {total === 1 ? "" : "s"} found
        </p>
      </div>

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
      ) : promotions.length === 0 ? (
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
            {promotions.map((promotion) => {
              const seller = sellerMap.get(promotion.seller_id);
              const businessName = promotion.business_id
                ? businessMap.get(promotion.business_id)
                : undefined;
              const now = new Date();
              const isBoosted = promotion.boost_until
                ? new Date(promotion.boost_until) > now
                : false;
              const isFeatured = promotion.featured_until
                ? new Date(promotion.featured_until) > now
                : false;

              return (
                <div key={promotion.id} className="space-y-1">
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
                    endDate={promotion.end_date}
                  />
                  {businessName && (
                    <p className="truncate px-2 text-xs font-medium text-brand-blue">
                      by {businessName}
                    </p>
                  )}
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
