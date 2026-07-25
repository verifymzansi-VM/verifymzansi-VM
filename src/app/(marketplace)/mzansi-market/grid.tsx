"use client";

import { useEffect, useState, useCallback, useTransition, useRef } from "react";
import { ListingCard } from "@/components/listings/listing-card";
import { ListingCardList } from "@/components/listings/listing-card-list";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import type { ListingCondition, AccountVerificationStatus } from "@/types/enums";
import { useMarketplaceStore } from "@/stores";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { GridStateMessage } from "@/components/listings/grid-state-message";
import { Plus, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketplacePaginationControls } from "@/components/listings/marketplace-pagination-controls";
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
  logo_url: string | null;
  boost_until: string | null;
  featured: boolean;
  seller: SellerRow | null;
  focal_x: number | null;
  focal_y: number | null;
  media_width: number | null;
  media_height: number | null;
  view_count?: number | null;
  like_count?: number | null;
  viewer_has_liked?: boolean;
}

interface SellerRow {
  display_name: string;
  account_verification_status: string;
}

interface ListingsResponse {
  listings?: ListingRow[];
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

const STAGGER_DELAY_CLASSES = [
  "[animation-delay:0ms]",
  "[animation-delay:50ms]",
  "[animation-delay:100ms]",
  "[animation-delay:150ms]",
  "[animation-delay:200ms]",
  "[animation-delay:250ms]",
  "[animation-delay:300ms]",
  "[animation-delay:350ms]",
  "[animation-delay:400ms]",
] as const;

function getStaggerDelayClass(index: number) {
  return STAGGER_DELAY_CLASSES[Math.min(index, STAGGER_DELAY_CLASSES.length - 1)];
}

function getListingCardProps(listing: ListingRow) {
  const videoUrl = listing.videos?.[0];
  const seller = listing.seller;

  return {
    id: listing.id,
    title: listing.title,
    price: listing.price_cents ?? 0,
    negotiable: listing.price_negotiable,
    imageUrl: videoUrl || listing.photos?.[0],
    posterUrl: listing.video_thumbnail || listing.photos?.[0] || undefined,
    logoUrl: listing.logo_url,
    province: listing.location_province,
    city: listing.location_city,
    category: listing.category,
    attributes: listing.attributes,
    condition: listing.condition ?? undefined,
    createdAt: listing.created_at,
    ownerTrustLevel: computeTrustLevel(
      (seller?.account_verification_status ?? null) as AccountVerificationStatus | null
    ),
    ownerName: seller?.display_name,
    boosted: listing.boost_until ? new Date(listing.boost_until) > new Date() : false,
    featured: listing.featured,
    focalX: listing.focal_x,
    focalY: listing.focal_y,
    mediaWidth: listing.media_width,
    mediaHeight: listing.media_height,
    viewCount: listing.view_count ?? undefined,
  };
}

export function MzansiMarketGrid() {
  const { filters, page, setPage, setFilter, resetFilters } = useMarketplaceStore();
  const [listings, setListings] = useState<ListingRow[]>([]);
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
          setTotalCount(0);
          setLoading(false);
          return;
        }

        setFetchError(null);
        setListings(payload.listings ?? []);
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
    const gridState: "error" | "filtered-empty" | "empty" = hasQueryError
      ? "error"
      : hasFilters
        ? "filtered-empty"
        : "empty";
    const emptyTitle = fetchError?.title
      ? fetchError.title
      : hasFilters
        ? "No listings match your filters"
        : "No listings yet";
    const emptyBody = fetchError?.body
      ? fetchError.body
      : hasFilters
        ? "Try adjusting your search or filters to find what you're looking for."
        : "Be the first identity-reviewed seller to post on Mzansi Market.";
    const suggestedCats = CATEGORIES.slice(0, 4);

    return (
      <GridStateMessage
        tone="green"
        state={gridState}
        title={emptyTitle}
        body={emptyBody}
        errorCode={fetchError?.code}
        testId="mzansi-market-grid-empty"
      >
        {hasFilters && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-xs text-muted-foreground">Try:</span>
            {suggestedCats.map((cat) => {
              const Icon = cat.icon;
              return (
                <Badge
                  key={cat.value}
                  variant="secondary"
                  className="cursor-pointer gap-1 transition-colors hover:bg-brand-green/10"
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
          <Button asChild size="lg">
            <Link href="/post/create">
              <Plus className="mr-1.5 h-4 w-4" />
              Post Your First Ad
            </Link>
          </Button>
        )}
      </GridStateMessage>
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
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6">
          {listings.map((listing, index) => {
            const cardProps = getListingCardProps(listing);

            return (
              <div
                key={listing.id}
                className={`content-auto animate-in fade-in fill-mode-both [animation-duration:400ms] sm:slide-in-from-bottom-2 ${getStaggerDelayClass(index)}`}
              >
                <ListingCard {...cardProps} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {listings.map((listing, index) => {
            const cardProps = getListingCardProps(listing);

            return (
              <div
                key={listing.id}
                className={`animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms] ${getStaggerDelayClass(index)}`}
              >
                <ListingCardList
                  {...cardProps}
                  likeCount={
                    typeof listing.like_count === "number" ? listing.like_count : undefined
                  }
                  viewerHasLiked={listing.viewer_has_liked ?? false}
                />
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <MarketplacePaginationControls
          page={page}
          totalPages={totalPages}
          onPageChange={(nextPage) => {
            triggerHaptic("light");
            setPage(nextPage);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}
    </div>
  );
}
