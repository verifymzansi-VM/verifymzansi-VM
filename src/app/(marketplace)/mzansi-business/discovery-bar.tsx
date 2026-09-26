"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMarketplaceStore } from "@/stores";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { cn } from "@/lib/utils";
import {
  FilterField,
  RemovableFilterChip,
  filterInputClass,
  filterSelectClass,
} from "@/components/listings/filter-controls";

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
    filters.businessType,
    filters.province,
    filters.city,
  ].filter(Boolean).length;

  return (
    // The page supplies the card surface around this panel, so render plain content here.
    <section aria-labelledby="business-filters-title" className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="business-filters-title"
            className="font-display text-base font-semibold tracking-tight"
          >
            Filters
          </h2>
        </div>
      </div>

      <div className="space-y-4">
        <FilterField label="Search" htmlFor="business-search">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              key={filters.query || "__empty-query__"}
              ref={searchInputRef}
              id="business-search"
              type="search"
              placeholder="Name, service or brand"
              className={cn(filterInputClass, "pl-9")}
              defaultValue={filters.query || ""}
              disabled={!isInteractive}
              onChange={(event) => {
                debouncedSetQuery(event.target.value);
              }}
            />
          </div>
        </FilterField>

        <FilterField label="Category" htmlFor="business-category">
          <select
            id="business-category"
            className={filterSelectClass}
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
        </FilterField>

        <FilterField label="Business type" htmlFor="business-type">
          <select
            id="business-type"
            className={filterSelectClass}
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
        </FilterField>

        <FilterField label="Province" htmlFor="business-province">
          <select
            id="business-province"
            className={filterSelectClass}
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
        </FilterField>

        <FilterField label="City" htmlFor="business-city">
          <select
            id="business-city"
            className={filterSelectClass}
            value={filters.city || ""}
            onChange={(event) => setFilter("city", event.target.value || undefined)}
            disabled={!isInteractive || !filters.province}
          >
            <option value="">{filters.province ? "All cities" : "Choose a province first"}</option>
            {filters.province &&
              getCitiesForProvince(filters.province).map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
          </select>
        </FilterField>
      </div>

      {hasActiveFilters > 0 && (
        <div className="space-y-2 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {filters.query && (
              <RemovableFilterChip
                label={filters.query}
                removeLabel={`Remove query filter ${filters.query}`}
                disabled={!isInteractive}
                onRemove={clearQueryFilter}
                onRemoveKeyDown={(event) => handleKeyboardChipClear(event, clearQueryFilter)}
              />
            )}
            {filters.businessCategory && (
              <RemovableFilterChip
                label={
                  BUSINESS_CATEGORIES.find((item) => item.value === filters.businessCategory)
                    ?.label ?? filters.businessCategory
                }
                removeLabel="Remove business category filter"
                disabled={!isInteractive}
                onRemove={() => setFilter("businessCategory", undefined)}
              />
            )}
            {filters.businessType && (
              <RemovableFilterChip
                label={
                  BUSINESS_TYPE_OPTIONS.find((item) => item.value === filters.businessType)
                    ?.label ?? filters.businessType
                }
                removeLabel="Remove business type filter"
                disabled={!isInteractive}
                onRemove={() => setFilter("businessType", undefined)}
              />
            )}
            {filters.province && (
              <RemovableFilterChip
                label={filters.city ? `${filters.city}, ${filters.province}` : filters.province}
                removeLabel="Remove location filter"
                disabled={!isInteractive}
                onRemove={() => {
                  setFilter("province", undefined);
                  setFilter("city", undefined);
                }}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              disabled={!isInteractive}
              onClick={clearAllFilters}
            >
              Clear all
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
