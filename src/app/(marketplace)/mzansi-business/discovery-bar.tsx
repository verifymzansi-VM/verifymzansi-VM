"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMarketplaceStore } from "@/stores";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";

export function BusinessDiscoveryBar() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isInteractive = useHydrated();
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setFilter("query", value || undefined),
    300
  );

  useEffect(() => {
    return () => debouncedSetQuery.cancel();
  }, [debouncedSetQuery]);

  const clearQueryFilter = () => {
    debouncedSetQuery.cancel();
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    setFilter("query", undefined);
  };

  const clearAllFilters = () => {
    debouncedSetQuery.cancel();
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    resetFilters();
  };

  const hasActiveFilters = [
    filters.query,
    filters.businessCategory,
    filters.businessType,
    filters.province,
    filters.city,
  ].filter(Boolean).length;

  return (
    <section className="space-y-5 rounded-2xl border border-border/70 bg-background/95 p-4 shadow-sm">
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-tight">Find a business faster</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Start with a search, then narrow by category, business type, and location.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="business-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              key={filters.query || "__empty-query__"}
              ref={searchInputRef}
              id="business-search"
              type="search"
              placeholder="Search businesses, services, or brands"
              className="pl-9"
              defaultValue={filters.query || ""}
              disabled={!isInteractive}
              onChange={(event) => {
                debouncedSetQuery(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-category">Category</Label>
          <select
            id="business-category"
            aria-label="Category"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
            value={filters.businessCategory || ""}
            disabled={!isInteractive}
            onChange={(event) =>
              setFilter(
                "businessCategory",
                event.target.value
                  ? (event.target.value as typeof filters.businessCategory)
                  : undefined
              )
            }
          >
            <option value="">All categories</option>
            {BUSINESS_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-type">Business type</Label>
          <select
            id="business-type"
            aria-label="Business type"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
            value={filters.businessType || ""}
            disabled={!isInteractive}
            onChange={(event) =>
              setFilter(
                "businessType",
                event.target.value ? (event.target.value as typeof filters.businessType) : undefined
              )
            }
          >
            <option value="">All types</option>
            {BUSINESS_TYPE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-province">Province</Label>
          <select
            id="business-province"
            aria-label="Province"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
            value={filters.province || ""}
            disabled={!isInteractive}
            onChange={(event) => {
              setFilter("province", event.target.value || undefined);
              setFilter("city", undefined);
            }}
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
          <Label htmlFor="business-city">City</Label>
          <select
            id="business-city"
            aria-label="City"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
            value={filters.city || ""}
            onChange={(event) => setFilter("city", event.target.value || undefined)}
            disabled={!isInteractive || !filters.province}
          >
            <option value="">{filters.province ? "All cities" : "Select province first"}</option>
            {filters.province &&
              getCitiesForProvince(filters.province).map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
          </select>
        </div>
      </div>

      {hasActiveFilters > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.query && (
            <Badge variant="secondary" className="gap-1">
              {filters.query}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove query filter ${filters.query}`}
                disabled={!isInteractive}
                onClick={clearQueryFilter}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.businessCategory && (
            <Badge variant="secondary" className="gap-1">
              {BUSINESS_CATEGORIES.find((item) => item.value === filters.businessCategory)?.label}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove business category filter"
                disabled={!isInteractive}
                onClick={() => setFilter("businessCategory", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.businessType && (
            <Badge variant="secondary" className="gap-1">
              {BUSINESS_TYPE_OPTIONS.find((item) => item.value === filters.businessType)?.label}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove business type filter"
                disabled={!isInteractive}
                onClick={() => setFilter("businessType", undefined)}
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
                aria-label="Remove location filter"
                disabled={!isInteractive}
                onClick={() => {
                  setFilter("province", undefined);
                  setFilter("city", undefined);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-11 px-3 text-sm sm:h-10 sm:text-xs"
            disabled={!isInteractive}
            onClick={clearAllFilters}
          >
            Clear all
          </Button>
        </div>
      )}
    </section>
  );
}
