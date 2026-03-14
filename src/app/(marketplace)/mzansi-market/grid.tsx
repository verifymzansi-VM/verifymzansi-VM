"use client";

import { useEffect, useState, useCallback, useTransition, useRef } from "react";
import { ListingCard } from "@/components/listings/listing-card";
import { ListingCardList } from "@/components/listings/listing-card-list";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import type { ListingCondition, AccountVerificationStatus } from "@/types/enums";
import { useMarketplaceStore } from "@/stores";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { PackageOpen, Plus, AlertTriangle, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { CATEGORIES } from "@/lib/constants/categories";
import { createLogger } from "@/lib/utils/logger";
import { triggerHaptic } from "@/lib/utils/haptics";
import { serializeMarketplaceFiltersToSearchParams } from "@/lib/utils/marketplace-query";

const PAGE_SIZE = 24;
const log = createLogger("MzansiMarketGrid");

interface ListingRow {
  id: string;
  title: string;
  description: string | null;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  category: string;
  condition: ListingCondition | null;
  attributes: Record<string, unknown>;
  created_at: string;
  photos: string[];
  videos: string[];
  video_thumbnail: string | null;
  boost_until: string | null;
  featured: boolean;
  owner_id: string;
}

interface OwnerRow {
  user_id: string;
  display_name: string;
  account_verification_status: string;
}

interface ListingsResponse {
  listings?: ListingRow[];
  sellers?: OwnerRow[];
  total?: number;
  page?: number;
  limit?: number;
  error?: string;
  code?: string;
  detail?: string;
}

interface GridFetchError {
  title: string;
  body: string;
  code?: string;
}

type ViewMode = "grid" | "list";

export function MzansiMarketGrid() {
  const { filters, page, setPage, setFilter, resetFilters } = useMarketplaceStore();
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [sellers, setSellers] = useState<Map<string, OwnerRow>>(new Map());
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<GridFetchError | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [, startTransition] = useTransition();
  const fetchGenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchListings = useCallback(
    async (gen: number) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);

      const params = serializeMarketplaceFiltersToSearchParams(
        {
          category: filters.category,
          query: filters.query,
          province: filters.province,
          city: filters.city,
          condition: filters.condition,
          sort: filters.sort,
          priceMin: filters.priceMin,
          priceMax: filters.priceMax,
          attributes: filters.attributes,
        },
        page
      );
      params.set("limit", String(PAGE_SIZE));

      try {
        const response = await fetch(`/api/listings?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ListingsResponse;

        if (gen !== fetchGenRef.current) return;

        if (!response.ok) {
          const nextError =
            payload.code === "PGRST205"
              ? {
                  title: payload.error || "Marketplace temporarily unavailable",
                  body:
                    payload.detail ||
                    "The marketplace database schema is not available yet. Please retry in a moment.",
                  code: payload.code,
                }
              : {
                  title: "Unable to load listings",
                  body: payload.error || "We could not fetch listings right now. Please try again.",
                  code: payload.code,
                };

          if (payload.code === "PGRST205") {
            log.warn("Listing fetch schema cache unavailable", {
              status: response.status,
              code: payload.code,
            });
          } else {
            log.error("Listing fetch error", {
              status: response.status,
              message: nextError.body,
              code: payload.code,
            });
          }

          setFetchError(nextError);
          setListings([]);
          setSellers(new Map());
          setTotalCount(0);
          setLoading(false);
          return;
        }

        setFetchError(null);
        setListings(payload.listings ?? []);
        setSellers(new Map((payload.sellers ?? []).map((seller) => [seller.user_id, seller])));
        setTotalCount(payload.total ?? 0);
        setLoading(false);
      } catch (error) {
        if (gen !== fetchGenRef.current) return;

        const message = error instanceof Error ? error.message : "Failed to load listings.";
        log.error("Listing fetch threw", { message });
        setFetchError({
          title: "Unable to load listings",
          body: "We could not fetch listings right now. Please try again.",
        });
        setListings([]);
        setSellers(new Map());
        setTotalCount(0);
        setLoading(false);
      }
    },
    [filters, page]
  );

  useEffect(() => {
    const gen = ++fetchGenRef.current;
    const timeout = setTimeout(() => {
      startTransition(() => {
        void fetchListings(gen);
      });
    }, 300);

    return () => clearTimeout(timeout);
  }, [fetchListings]);

  const activeFilterCount = [
    filters.category,
    filters.province,
    filters.city,
    filters.priceMin,
    filters.priceMax,
    filters.condition,
    filters.query,
    ...Object.values(filters.attributes).filter((value) => value !== undefined && value !== ""),
  ].filter(Boolean).length;

  if (loading) {
    return (
      <div data-testid="mzansi-market-grid-loading">
        <ListingGridSkeleton />
      </div>
    );
  }

  if (listings.length === 0) {
    const hasFilters = activeFilterCount > 0 && !fetchError;
    const hasQueryError = Boolean(fetchError);
    const emptyTitle = fetchError?.title
      ? fetchError.title
      : hasFilters
        ? "No listings match your filters"
        : "No listings yet";
    const emptyBody = fetchError?.body
      ? fetchError.body
      : hasFilters
        ? "Try adjusting your search or filters to find what you're looking for."
        : "Be the first to post a verified ad on Mzansi Market.";
    const suggestedCats = CATEGORIES.slice(0, 4);

    return (
      <div
        className="flex flex-col items-center justify-center py-6 sm:py-8 space-y-3"
        data-testid="mzansi-market-grid-empty"
        data-grid-state={hasQueryError ? "error" : hasFilters ? "filtered-empty" : "empty"}
      >
        <div className="rounded-2xl bg-gradient-to-br from-brand-green-50 to-brand-green-100 dark:from-brand-green-950 dark:to-brand-green-900 p-5 shadow-sm">
          {hasQueryError ? (
            <AlertTriangle className="h-8 w-8 text-brand-green" />
          ) : (
            <PackageOpen className="h-8 w-8 text-brand-green" />
          )}
        </div>
        <div className="text-center space-y-2 max-w-md">
          <p className="text-lg font-display font-semibold">{emptyTitle}</p>
          <p className="text-sm text-muted-foreground">{emptyBody}</p>
          {fetchError?.code && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {fetchError.code}
            </Badge>
          )}
        </div>

        {hasFilters && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Try:</span>
            {suggestedCats.map((cat) => {
              const Icon = cat.icon;
              return (
                <Badge
                  key={cat.value}
                  variant="secondary"
                  className="gap-1 cursor-pointer hover:bg-brand-green/10 transition-colors"
                  onClick={() => {
                    resetFilters();
                    setFilter("category", cat.value);
                  }}
                >
                  <Icon className="h-3 w-3" />
                  {cat.label}
                </Badge>
              );
            })}
          </div>
        )}

        {hasQueryError && (
          <Button
            variant="outline"
            onClick={() =>
              startTransition(() => {
                const gen = ++fetchGenRef.current;
                void fetchListings(gen);
              })
            }
          >
            Retry
          </Button>
        )}

        {hasFilters && (
          <Button variant="outline" onClick={resetFilters}>
            Clear Filters
          </Button>
        )}

        {!hasFilters && !hasQueryError && (
          <Button asChild size="lg" className="mt-2 shadow-md">
            <Link href="/post/create">
              <Plus className="mr-1.5 h-4 w-4" />
              Post Your First Ad
            </Link>
          </Button>
        )}
      </div>
    );
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6" data-testid="mzansi-market-grid-ready">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
          <span className="font-medium text-foreground">{totalCount}</span> listing
          {totalCount !== 1 ? "s" : ""} found
          {activeFilterCount > 0 && (
            <span className="ml-1.5">
              · <span className="text-brand-green font-medium">{activeFilterCount}</span> filter
              {activeFilterCount !== 1 ? "s" : ""} active
            </span>
          )}
        </p>

        {/* View mode toggle */}
        <div className="flex items-center rounded-lg border border-border p-0.5 gap-0.5">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === "grid"
                ? "bg-brand-green/10 text-brand-green"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="Grid view"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === "list"
                ? "bg-brand-green/10 text-brand-green"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label="List view"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((listing, index) => {
            const videoUrl = listing.videos?.[0];
            const displayUrl = videoUrl || listing.photos?.[0];
            const posterSrc = listing.video_thumbnail || listing.photos?.[0] || undefined;
            const seller = sellers.get(listing.owner_id);
            const trustLevel = computeTrustLevel(
              (seller?.account_verification_status ?? null) as AccountVerificationStatus | null
            );
            const isBoosted = listing.boost_until
              ? new Date(listing.boost_until) > new Date()
              : false;

            return (
              <div
                key={listing.id}
                className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms]"
                style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}
              >
                <ListingCard
                  id={listing.id}
                  title={listing.title}
                  price={listing.price_cents ?? 0}
                  negotiable={listing.price_negotiable}
                  imageUrl={displayUrl}
                  posterUrl={posterSrc}
                  province={listing.location_province}
                  city={listing.location_city}
                  category={listing.category}
                  attributes={listing.attributes}
                  condition={listing.condition ?? undefined}
                  createdAt={listing.created_at}
                  ownerTrustLevel={trustLevel}
                  ownerName={seller?.display_name}
                  boosted={isBoosted}
                  featured={listing.featured}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {listings.map((listing, index) => {
            const videoUrl = listing.videos?.[0];
            const displayUrl = videoUrl || listing.photos?.[0];
            const posterSrc = listing.video_thumbnail || listing.photos?.[0] || undefined;
            const seller = sellers.get(listing.owner_id);
            const trustLevel = computeTrustLevel(
              (seller?.account_verification_status ?? null) as AccountVerificationStatus | null
            );
            const isBoosted = listing.boost_until
              ? new Date(listing.boost_until) > new Date()
              : false;

            return (
              <div
                key={listing.id}
                className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms]"
                style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}
              >
                <ListingCardList
                  id={listing.id}
                  title={listing.title}
                  price={listing.price_cents ?? 0}
                  negotiable={listing.price_negotiable}
                  imageUrl={displayUrl}
                  posterUrl={posterSrc}
                  province={listing.location_province}
                  city={listing.location_city}
                  category={listing.category}
                  attributes={listing.attributes}
                  condition={listing.condition ?? undefined}
                  createdAt={listing.created_at}
                  ownerTrustLevel={trustLevel}
                  ownerName={seller?.display_name}
                  viewCount={undefined}
                  boosted={isBoosted}
                  featured={listing.featured}
                />
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={page <= 1}
            onClick={() => {
              triggerHaptic("light");
              setPage(page - 1);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Previous
          </Button>

          <div className="hidden sm:flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pageNum =
                totalPages <= 5
                  ? i + 1
                  : page <= 3
                    ? i + 1
                    : page >= totalPages - 2
                      ? totalPages - 4 + i
                      : page - 2 + i;

              return (
                <Button
                  key={pageNum}
                  variant={pageNum === page ? "default" : "ghost"}
                  size="sm"
                  className={`w-8 h-8 p-0 ${pageNum === page ? "pointer-events-none" : ""}`}
                  onClick={() => {
                    triggerHaptic("light");
                    setPage(pageNum);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  {pageNum}
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
              setPage(page + 1);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
