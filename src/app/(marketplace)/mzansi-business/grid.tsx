"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, Plus } from "lucide-react";
import { BusinessCard } from "@/components/listings/business-card";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { Button } from "@/components/ui/button";
import { useMarketplaceStore } from "@/stores";
import { createLogger } from "@/lib/utils/logger";
import type { BusinessCategory, BusinessType } from "@/types/enums";

const PAGE_SIZE = 24;
const log = createLogger("MzansiBusinessGrid");

interface BusinessRow {
  id: string;
  business_type: BusinessType;
  business_name: string;
  description: string | null;
  cover_photo: string | null;
  cover_video: string | null;
  video_thumbnail: string | null;
  logo_url: string | null;
  gallery_photos: string[] | null;
  location_province: string;
  location_city: string;
  category: BusinessCategory;
  boost_until: string | null;
  featured_until: string | null;
  service_areas: Record<string, unknown> | null;
}

interface BusinessesResponse {
  businesses?: BusinessRow[];
  total?: number;
  page?: number;
  limit?: number;
  error?: string;
}

export function MzansiBusinessGrid() {
  const { filters, page, setPage, resetFilters } = useMarketplaceStore();
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fetchGenRef = useRef(0);

  const fetchBusinesses = useCallback(
    async (gen: number) => {
      setLoading(true);

      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });

      if (filters.businessCategory) {
        params.set("category", filters.businessCategory);
      }

      if (filters.query) {
        params.set("q", filters.query);
      }

      if (filters.businessType) {
        params.set("type", filters.businessType);
      }

      if (filters.province) {
        params.set("province", filters.province);
      }

      if (filters.city) {
        params.set("city", filters.city);
      }

      if (filters.mall) {
        params.set("mall", filters.mall);
      }

      try {
        const response = await fetch(`/api/businesses?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as BusinessesResponse;

        if (gen !== fetchGenRef.current) {
          return;
        }

        if (!response.ok) {
          const message = payload.error || "Failed to load businesses.";
          log.error("Business fetch error", { status: response.status, message });
          setFetchError(message);
          setBusinesses([]);
          setTotalCount(0);
          setLoading(false);
          return;
        }

        setFetchError(null);
        setBusinesses(payload.businesses ?? []);
        setTotalCount(payload.total ?? 0);
        setLoading(false);
      } catch (error) {
        if (gen !== fetchGenRef.current) {
          return;
        }

        const message = error instanceof Error ? error.message : "Failed to load businesses.";
        log.error("Business fetch threw", { message });
        setFetchError(message);
        setBusinesses([]);
        setTotalCount(0);
        setLoading(false);
      }
    },
    [
      filters.businessCategory,
      filters.businessType,
      filters.query,
      filters.province,
      filters.city,
      filters.mall,
      page,
    ]
  );

  useEffect(() => {
    const gen = ++fetchGenRef.current;
    startTransition(() => {
      void fetchBusinesses(gen);
    });
  }, [fetchBusinesses]);

  const activeFilterCount = [
    filters.businessCategory,
    filters.businessType,
    filters.query,
    filters.province,
    filters.city,
    filters.mall,
  ].filter(Boolean).length;

  const handleRetry = () => {
    startTransition(() => {
      const gen = ++fetchGenRef.current;
      void fetchBusinesses(gen);
    });
  };

  if (loading) {
    return (
      <div data-testid="mzansi-business-grid-loading">
        <ListingGridSkeleton />
      </div>
    );
  }

  if (businesses.length === 0) {
    const hasFilters = activeFilterCount > 0 && !fetchError;
    const hasQueryError = Boolean(fetchError);
    const emptyTitle = hasQueryError
      ? "Unable to load businesses"
      : hasFilters
        ? "No businesses match your filters"
        : "No businesses yet";
    const emptyBody = hasQueryError
      ? "We could not fetch businesses right now. Please try again."
      : hasFilters
        ? "Try adjusting or clearing your filters."
        : "Be the first to list your business on Mzansi Business.";

    return (
      <div
        className="flex flex-col items-center justify-center py-6 sm:py-8 space-y-3"
        data-testid="mzansi-business-grid-empty"
        data-grid-state={hasQueryError ? "error" : hasFilters ? "filtered-empty" : "empty"}
      >
        <div className="rounded-2xl bg-gradient-to-br from-brand-blue/10 to-brand-blue/20 p-5 shadow-sm">
          {hasQueryError ? (
            <AlertTriangle className="h-8 w-8 text-brand-blue" />
          ) : (
            <Building2 className="h-8 w-8 text-brand-blue" />
          )}
        </div>

        <div className="text-center space-y-2 max-w-md">
          <p className="text-lg font-display font-semibold">{emptyTitle}</p>
          <p className="text-sm text-muted-foreground">{emptyBody}</p>
        </div>

        {hasQueryError && (
          <Button variant="outline" onClick={handleRetry}>
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
            <Link href="/post/create-business">
              <Plus className="mr-1.5 h-4 w-4" />
              List Your Business
            </Link>
          </Button>
        )}
      </div>
    );
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6" data-testid="mzansi-business-grid-ready">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
          <span className="font-medium text-foreground">{totalCount}</span> business
          {totalCount !== 1 ? "es" : ""} found
          {activeFilterCount > 0 && (
            <span className="ml-1.5">
              · <span className="text-brand-blue font-medium">{activeFilterCount}</span> filter
              {activeFilterCount !== 1 ? "s" : ""} active
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {businesses.map((business, index) => (
          <div
            key={business.id}
            className={`animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms] [animation-delay:${Math.min(index * 50, 400)}ms]`}
          >
            <BusinessCard
              id={business.id}
              businessName={business.business_name}
              businessType={business.business_type}
              description={business.description ?? undefined}
              coverPhoto={business.cover_photo}
              coverVideo={business.cover_video}
              videoThumbnail={business.video_thumbnail}
              logoUrl={business.logo_url}
              galleryPhotos={business.gallery_photos}
              province={business.location_province}
              city={business.location_city}
              category={business.category}
              boostUntil={business.boost_until}
              featuredUntil={business.featured_until}
              serviceAreas={business.service_areas}
            />
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>

          <div className="flex items-center gap-1">
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
                  onClick={() => setPage(pageNum)}
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
