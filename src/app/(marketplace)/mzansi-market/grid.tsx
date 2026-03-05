"use client";

import { useEffect, useState, useCallback, useTransition, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ListingCard } from "@/components/listings/listing-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import type { SellerVerificationStatus } from "@/types/enums";
import { useMarketplaceStore } from "@/stores";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";
import { PackageOpen, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { CATEGORIES } from "@/lib/constants/categories";
import { mapListingCategory } from "@/lib/utils/enum-compat";
import { createLogger } from "@/lib/utils/logger";

const PAGE_SIZE = 24;

interface ListingRow {
  id: string;
  title: string;
  price_cents: number | null;
  price_negotiable: boolean;
  location_province: string;
  location_city: string;
  category: string;
  attributes: Record<string, unknown>;
  created_at: string;
  photos: string[];
  videos: string[];
  video_thumbnail: string | null;
  boost_until: string | null;
  featured: boolean;
  seller_id: string;
}

interface SellerRow {
  user_id: string;
  display_name: string;
  seller_verification_status: string;
}

export function MzansiMarketGrid() {
  const { filters, page, setPage } = useMarketplaceStore();
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [sellers, setSellers] = useState<Map<string, SellerRow>>(new Map());
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<{
    code: string | null;
    message: string | null;
  } | null>(null);
  const [, startTransition] = useTransition();
  const fetchGenRef = useRef(0);

  const fetchListings = useCallback(
    async (gen: number) => {
      setLoading(true);
      const supabase = createClient();

      /* ── Build the query ─────────────────────────────────────── */
      let query = supabase
        .from("listings")
        .select(
          `id, title, price_cents, price_negotiable, location_province,
         location_city, category, attributes, created_at, photos, videos,
         video_thumbnail, boost_until, featured, seller_id`,
          { count: "exact" }
        )
        .eq("status", "live")
        .eq("area", "MZANSI_MARKET");

      // Category filter
      if (filters.category) {
        query = query.eq("category", mapListingCategory(filters.category));
      }

      // Province filter
      if (filters.province) {
        query = query.eq("location_province", filters.province);
      }

      // City filter
      if (filters.city) {
        query = query.eq("location_city", filters.city);
      }

      // Price range (values in ZAR from UI → convert to cents for DB)
      if (filters.priceMin) {
        query = query.gte("price_cents", filters.priceMin * 100);
      }
      if (filters.priceMax) {
        query = query.lte("price_cents", filters.priceMax * 100);
      }

      // Condition filter (stored in attributes JSON)
      if (filters.condition) {
        query = query.eq("attributes->>condition", filters.condition);
      }

      // Text search
      if (filters.query?.trim()) {
        query = query.ilike("title", `%${filters.query.trim()}%`);
      }

      // Dynamic attribute filters
      for (const [key, val] of Object.entries(filters.attributes)) {
        if (val !== undefined && val !== "") {
          if (typeof val === "boolean") {
            query = query.eq(`attributes->>${key}`, String(val));
          } else {
            query = query.eq(`attributes->>${key}`, val);
          }
        }
      }

      // Sorting
      switch (filters.sort) {
        case "price_asc":
          query = query.order("price_cents", { ascending: true });
          break;
        case "price_desc":
          query = query.order("price_cents", { ascending: false });
          break;
        case "popular":
          query = query
            .order("featured", { ascending: false })
            .order("boost_until", { ascending: false, nullsFirst: false });
          break;
        case "newest":
        default:
          query = query
            .order("featured", { ascending: false })
            .order("created_at", { ascending: false });
          break;
      }

      // Pagination
      const from = (page - 1) * PAGE_SIZE;
      query = query.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await query;

      if (error) {
        const log = createLogger("MzansiMarketGrid");
        if (error.code === "PGRST205") {
          log.warn("Schema cache issue", { code: error.code, message: error.message });
        } else {
          log.error("Listing fetch error", { code: error.code ?? null, message: error.message });
        }
        setFetchError({
          code: error.code ?? null,
          message: error.message ?? "Failed to load listings.",
        });
        setListings([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }

      const items = data ?? [];

      // Guard: if a newer fetch has started, discard this stale result
      if (gen !== fetchGenRef.current) return;

      setFetchError(null);
      setTotalCount(count ?? 0);

      /* ── Batch-fetch seller profiles ─────────────────────────── */
      if (items.length > 0) {
        const sellerIds = Array.from(new Set(items.map((l: ListingRow) => l.seller_id)));
        const { data: sellerData } = await supabase
          .from("seller_profiles")
          .select("user_id, display_name, seller_verification_status")
          .in("user_id", sellerIds);

        setSellers(new Map((sellerData ?? []).map((s: SellerRow) => [s.user_id, s] as const)));
      } else {
        setSellers(new Map());
      }

      setListings(items);
      setLoading(false);
    },
    [filters, page]
  );

  // Re-fetch when filters or page change — debounced to avoid rapid-fire
  // queries on mobile when users tap through filters quickly.
  useEffect(() => {
    const gen = ++fetchGenRef.current;
    const timeout = setTimeout(() => {
      startTransition(() => {
        fetchListings(gen);
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [fetchListings]);

  /* ── Count active filters ──────────────────────────────── */
  const activeFilterCount = [
    filters.category,
    filters.province,
    filters.city,
    filters.priceMin,
    filters.priceMax,
    filters.condition,
    filters.query,
    ...Object.values(filters.attributes).filter((v) => v !== undefined && v !== ""),
  ].filter(Boolean).length;

  /* ── Loading state ──────────────────────────────────────── */
  if (loading) {
    return <ListingGridSkeleton />;
  }

  /* ── Empty state ────────────────────────────────────────── */
  if (listings.length === 0) {
    const hasFilters = activeFilterCount > 0 && !fetchError;
    const isSchemaCacheError = fetchError?.code === "PGRST205";
    const hasQueryError = Boolean(fetchError);
    const emptyTitle = isSchemaCacheError
      ? "Marketplace temporarily unavailable"
      : hasQueryError
        ? "Unable to load listings"
        : hasFilters
          ? "No listings match your filters"
          : "No listings yet";
    const emptyBody = isSchemaCacheError
      ? "The marketplace database schema is not available yet. Please retry in a moment."
      : hasQueryError
        ? "We could not fetch listings right now. Please try again."
        : hasFilters
          ? "Try adjusting your search or filters to find what you're looking for."
          : "Be the first to post a verified ad on Mzansi Market.";

    // Pick 4 random suggested categories
    const suggestedCats = CATEGORIES.slice(0, 4);

    return (
      <div className="flex flex-col items-center justify-center py-6 sm:py-8 space-y-3">
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
          {hasQueryError && fetchError?.code && (
            <p className="text-xs text-muted-foreground">
              Error code: <span className="font-mono">{fetchError.code}</span>
            </p>
          )}
        </div>

        {/* Category suggestions when filters active */}
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
                fetchListings(gen);
              })
            }
          >
            Retry
          </Button>
        )}

        {!hasFilters && !hasQueryError && (
          <Button asChild size="lg" className="mt-2 shadow-md">
            <Link href="/post/create-listing">
              <Plus className="mr-1.5 h-4 w-4" />
              Post Your First Ad
            </Link>
          </Button>
        )}
      </div>
    );
  }

  /* ── Grid with pagination ───────────────────────────────── */
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-6">
      {/* Result summary */}
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
      </div>

      {/* Listing cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {listings.map((listing, index) => {
          const videoUrl =
            listing.videos?.[0] ||
            listing.photos?.find((url: string) => url.match(/\.(mp4|webm|ogg)(\?.*)?$/i));
          const displayUrl = videoUrl || listing.photos?.[0];
          const posterSrc = listing.video_thumbnail || listing.photos?.[0] || undefined;
          const seller = sellers.get(listing.seller_id);
          const trustLevel = computeTrustLevel(
            (seller?.seller_verification_status ?? null) as SellerVerificationStatus | null
          );
          const isBoosted = listing.boost_until
            ? new Date(listing.boost_until) > new Date()
            : false;

          // Check if listing is new (within 24 hours)
          const _isNew =
            new Date().getTime() - new Date(listing.created_at).getTime() < 24 * 60 * 60 * 1000;

          return (
            <div
              key={listing.id}
              className={`animate-in fade-in slide-in-from-bottom-2 fill-mode-both [animation-duration:400ms] [animation-delay:${Math.min(index * 50, 400)}ms]`}
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
                condition={listing.attributes?.condition as string | undefined}
                createdAt={listing.created_at}
                sellerTrustLevel={trustLevel}
                sellerName={seller?.display_name}
                boosted={isBoosted}
                featured={listing.featured}
              />
            </div>
          );
        })}
      </div>

      {/* Pagination */}
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

          {/* Page numbers */}
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
