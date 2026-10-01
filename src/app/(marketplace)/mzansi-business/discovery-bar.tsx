"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useHydrated } from "@/hooks/use-hydrated";
import { useFilterOrganisations } from "@/hooks/use-filter-organisations";
import { useMarketplaceStore } from "@/stores";
import {
  ALL_BUSINESS_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_TYPE_OPTIONS,
} from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";

export function BusinessDiscoveryBar() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isInteractive = useHydrated();
  const organisations = useFilterOrganisations(true);
  const selectedOrganisation = organisations.find((org) => org.slug === filters.organisation);
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setFilter("query", value || undefined),
    300
  );

  useEffect(() => {
    return () => debouncedSetQuery.cancel();
  }, [debouncedSetQuery]);

  // The search box is uncontrolled so typing never remounts it (which dropped
  // focus after every debounced commit). Mirror query changes made elsewhere
  // (URL hydration, back/forward, chips) without touching the box mid-typing.
  useEffect(() => {
    const input = searchInputRef.current;
    const query = filters.query ?? "";
    if (input && document.activeElement !== input && input.value !== query) {
      input.value = query;
    }
  }, [filters.query]);

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

  const handleKeyboardChipClear = (
    event: KeyboardEvent<HTMLButtonElement>,
    onClear: () => void
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClear();
    }
  };

  const hasActiveFilters = [
    filters.query,
    filters.businessCategory,
    filters.businessSubcategory,
    filters.businessType,
    filters.province,
    filters.city,
    filters.organisation,
  ].filter(Boolean).length;

  return (
    // Unnamed on purpose: the page's <aside aria-label="Business filters"> names this landmark.
    <section className="space-y-5 rounded-2xl border border-border/70 bg-background/95 p-5 elev-sm">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="business-search">Find a business</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
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
            {filters.businessCategory &&
              !BUSINESS_CATEGORIES.some((c) => c.value === filters.businessCategory) && (
                <option value={filters.businessCategory}>
                  {ALL_BUSINESS_CATEGORIES.find((c) => c.value === filters.businessCategory)
                    ?.label ?? filters.businessCategory}{" "}
                  (previous category)
                </option>
              )}
            {BUSINESS_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {filters.businessCategory && (
          <div className="space-y-1.5">
            <Label htmlFor="business-subcategory">Specific business activity</Label>
            <select
              id="business-subcategory"
              value={filters.businessSubcategory || ""}
              disabled={!isInteractive}
              className="h-11 w-full rounded-md border border-input bg-background px-3"
              onChange={(e) => setFilter("businessSubcategory", e.target.value || undefined)}
            >
              <option value="">All activities</option>
              {ALL_BUSINESS_CATEGORIES.find(
                (c) => c.value === filters.businessCategory
              )?.subcategories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {organisations.length > 0 || filters.organisation ? (
          <div className="space-y-1.5">
            <Label htmlFor="business-organisation">Programme partner</Label>
            <select
              id="business-organisation"
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm"
              value={filters.organisation || ""}
              disabled={!isInteractive}
              onChange={(event) => setFilter("organisation", event.target.value || undefined)}
            >
              <option value="">All businesses</option>
              {filters.organisation && !selectedOrganisation ? (
                <option value={filters.organisation}>
                  {filters.organisation.replace(/-/g, " ")}
                </option>
              ) : null}
              {organisations.map((org) => (
                <option key={org.slug} value={org.slug}>
                  {org.name}
                </option>
              ))}
            </select>
            {filters.organisation ? (
              <Link
                href={`/organisation/${filters.organisation}`}
                className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-green-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
              >
                View {selectedOrganisation?.name ?? "programme"} page
                <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        ) : null}

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
          <Label htmlFor="business-city">City or town</Label>
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
                className="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove query filter ${filters.query}`}
                disabled={!isInteractive}
                onClick={clearQueryFilter}
                onKeyDown={(event) => handleKeyboardChipClear(event, clearQueryFilter)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.businessCategory && (
            <Badge variant="secondary" className="gap-1">
              {ALL_BUSINESS_CATEGORIES.find((item) => item.value === filters.businessCategory)
                ?.label ?? filters.businessCategory}
              {!BUSINESS_CATEGORIES.some((item) => item.value === filters.businessCategory) &&
                " (previous category)"}
              <button
                type="button"
                className="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove business category filter"
                disabled={!isInteractive}
                onClick={() => setFilter("businessCategory", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.businessSubcategory && (
            <Badge variant="secondary" className="gap-1">
              {ALL_BUSINESS_CATEGORIES.flatMap((c) => c.subcategories).find(
                (c) => c.value === filters.businessSubcategory
              )?.label ?? filters.businessSubcategory}
              <button
                type="button"
                className="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove specific business activity filter"
                disabled={!isInteractive}
                onClick={() => setFilter("businessSubcategory", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.businessType && (
            <Badge variant="secondary" className="gap-1">
              {BUSINESS_TYPE_OPTIONS.find((item) => item.value === filters.businessType)?.label ??
                filters.businessType}{" "}
              (previous filter)
              <button
                type="button"
                className="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                className="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          {filters.organisation && (
            <Badge variant="secondary" className="gap-1">
              {selectedOrganisation?.name ?? filters.organisation.replace(/-/g, " ")}
              <button
                type="button"
                className="-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove programme partner filter"
                disabled={!isInteractive}
                onClick={() => setFilter("organisation", undefined)}
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
