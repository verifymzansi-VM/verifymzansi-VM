"use client";

import { ArrowUpDown } from "lucide-react";
import { useMarketplaceStore } from "@/stores";
import { CATEGORIES, BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { getListingConditionLabel } from "@/lib/constants/listing-condition";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  RemovableFilterChip,
  describeAttributeFilter,
  formatPriceRangeLabel,
} from "./filter-controls";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ListingGridHeader() {
  const { filters, setFilter, setAttribute, resetFilters } = useMarketplaceStore();
  const isHydrated = useHydrated();

  const sortOptions = [
    { value: "newest", label: "Recently posted" },
    { value: "price_asc", label: "Lowest price" },
    { value: "price_desc", label: "Highest price" },
    { value: "popular", label: "Most popular" },
  ];
  const currentSortLabel =
    sortOptions.find((o) => o.value === filters.sort)?.label || "Recently posted";

  const hasActiveFilters =
    filters.query ||
    filters.category ||
    filters.province ||
    filters.city ||
    filters.priceMin ||
    filters.priceMax ||
    filters.condition ||
    Object.values(filters.attributes).some((v) => v !== undefined && v !== "");

  return (
    <div className="mb-5 space-y-3">
      {/* Toolbar row */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {isHydrated ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`Sort: ${currentSortLabel}`}
                className="flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="hidden sm:inline">{currentSortLabel}</span>
                <span className="sm:hidden">Sort</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {sortOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() =>
                      setFilter(
                        "sort",
                        option.value as "newest" | "price_asc" | "price_desc" | "popular"
                      )
                    }
                    className={filters.sort === option.value ? "bg-accent font-medium" : ""}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              className="flex min-h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm font-medium text-foreground opacity-70"
              disabled
            >
              <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="hidden sm:inline">{currentSortLabel}</span>
              <span className="sm:hidden">Sort</span>
            </button>
          )}
        </div>
      </div>

      {/* Active filter chips – hidden on mobile where ActiveFilterChips handles this */}
      {hasActiveFilters && (
        <div className="hidden flex-wrap items-center gap-1.5 lg:flex">
          {filters.query && (
            <RemovableFilterChip
              label={filters.query}
              removeLabel={`Remove query filter ${filters.query}`}
              onRemove={() => setFilter("query", undefined)}
            />
          )}
          {filters.category && (
            <RemovableFilterChip
              label={
                [...CATEGORIES, ...BUSINESS_CATEGORIES].find((c) => c.value === filters.category)
                  ?.label ||
                filters.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
              }
              removeLabel="Remove category filter"
              onRemove={() => setFilter("category", undefined)}
            />
          )}
          {filters.province && (
            <RemovableFilterChip
              label={filters.city ? `${filters.city}, ${filters.province}` : filters.province}
              removeLabel="Remove location filter"
              onRemove={() => {
                setFilter("province", undefined);
                setFilter("city", undefined);
              }}
            />
          )}
          {filters.condition && (
            <RemovableFilterChip
              label={getListingConditionLabel(filters.condition)}
              removeLabel="Remove condition filter"
              onRemove={() => setFilter("condition", undefined)}
            />
          )}
          {(filters.priceMin || filters.priceMax) && (
            <RemovableFilterChip
              label={formatPriceRangeLabel(filters.priceMin, filters.priceMax)}
              removeLabel="Remove price filter"
              onRemove={() => {
                setFilter("priceMin", undefined);
                setFilter("priceMax", undefined);
              }}
            />
          )}
          {Object.entries(filters.attributes)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([name, val]) => (
              <RemovableFilterChip
                key={name}
                label={describeAttributeFilter(filters.category, name, val!)}
                removeLabel={`Remove ${name.replace(/_/g, " ")} filter`}
                onRemove={() => setAttribute(name, undefined)}
              />
            ))}
          <button
            type="button"
            className="min-h-9 rounded-full px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={resetFilters}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
