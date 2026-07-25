"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { GridStateMessage } from "@/components/listings/grid-state-message";
import {
  BusinessCardGridItem,
  type BusinessCardGridRow,
} from "@/components/listings/business-card-grid-item";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { MarketplacePaginationControls } from "@/components/listings/marketplace-pagination-controls";
import { Button } from "@/components/ui/button";
import { useMarketplaceStore } from "@/stores";
import { createLogger } from "@/lib/utils/logger";
import { triggerHaptic } from "@/lib/utils/haptics";
import type { BusinessCategory } from "@/types/enums";

const PAGE_SIZE = 24;
const log = createLogger("MzansiBusinessGrid");

interface BusinessRow extends BusinessCardGridRow {
  category: BusinessCategory;
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

export function MzansiBusinessGrid() {
  const { filters, page, setPage, resetFilters } = useMarketplaceStore();
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fetchGenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchBusinesses = useCallback(
    async (gen: number) => {
      // Abort any in-flight request
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);

      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
      });

      if (filters.businessCategory) {
        params.set("category", filters.businessCategory);
      }

      if (filters.businessSubcategory) {
        params.set("subcategory", filters.businessSubcategory);
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

      try {
        const response = await fetch(`/api/businesses?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
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
      filters.businessSubcategory,
      filters.businessType,
      filters.query,
      filters.province,
      filters.city,
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
    filters.businessSubcategory,
    filters.businessType,
    filters.query,
    filters.province,
    filters.city,
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
        : "No representative profiles yet";
    const emptyBody = hasQueryError
      ? "We could not fetch businesses right now. Please try again."
      : hasFilters
        ? "Try adjusting or clearing your filters."
        : "Be the first identity-reviewed representative to post a business profile on Mzansi Business.";

    return (
      <GridStateMessage
        tone="blue"
        state={hasQueryError ? "error" : hasFilters ? "filtered-empty" : "empty"}
        title={emptyTitle}
        body={emptyBody}
        icon={<Building2 className="h-7 w-7 text-brand-blue" />}
        testId="mzansi-business-grid-empty"
      >
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
          <Button asChild size="lg">
            <Link href="/post/create-business">
              <Plus className="mr-1.5 h-4 w-4" />
              Create Business Profile
            </Link>
          </Button>
        )}
      </GridStateMessage>
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:gap-5 xl:gap-6">
        {businesses.map((business, index) => (
          <BusinessCardGridItem key={business.id} business={business} index={index} />
        ))}
      </div>

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
