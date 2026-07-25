"use client";

import { ArrowUpDown, X } from "lucide-react";
import { useMarketplaceStore } from "@/stores";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES, BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { getListingConditionLabel } from "@/lib/constants/listing-condition";
import { useHydrated } from "@/hooks/use-hydrated";
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
    { value: "price_asc", label: "Price: Low → High" },
    { value: "price_desc", label: "Price: High → Low" },
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
    <div className="space-y-3 mb-5">
      {/* Toolbar row */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {isHydrated ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex min-h-9 items-center gap-1.5 rounded-full border border-border/80 bg-background px-3.5 py-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:border-brand-green/50 hover:text-brand-green focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">{currentSortLabel}</span>
                <span className="sm:hidden">Sort</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[160px]">
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
              className="flex items-center gap-1.5 border-none bg-transparent text-xs font-medium text-foreground"
              disabled
            >
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="hidden sm:inline">{currentSortLabel}</span>
              <span className="sm:hidden">Sort</span>
            </button>
          )}
        </div>
      </div>

      {/* Active filter chips – hidden on mobile where ActiveFilterChips handles this */}
      {hasActiveFilters && (
        <div className="hidden lg:flex flex-wrap items-center gap-1.5">
          {filters.query && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              {filters.query}
              <button
                type="button"
                className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove query filter ${filters.query}`}
                onClick={() => setFilter("query", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.category && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              {[...CATEGORIES, ...BUSINESS_CATEGORIES].find((c) => c.value === filters.category)
                ?.label ||
                filters.category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              <button
                type="button"
                className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove category filter"
                onClick={() => setFilter("category", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.province && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              {filters.province}
              {filters.city && ` › ${filters.city}`}
              <button
                type="button"
                className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove location filter"
                onClick={() => setFilter("province", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.condition && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              {getListingConditionLabel(filters.condition)}
              <button
                type="button"
                className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove condition filter"
                onClick={() => setFilter("condition", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {(filters.priceMin || filters.priceMax) && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              R{filters.priceMin || 0} – R{filters.priceMax || "∞"}
              <button
                type="button"
                className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove price filter"
                onClick={() => {
                  setFilter("priceMin", undefined);
                  setFilter("priceMax", undefined);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {Object.entries(filters.attributes)
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([name, val]) => (
              <Badge
                key={name}
                variant="secondary"
                className="gap-1 text-xs px-2 py-0.5 rounded-md capitalize"
              >
                {typeof val === "boolean" ? name.replace(/_/g, " ") : String(val)}
                <button
                  type="button"
                  className="rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${name.replace(/_/g, " ")} filter`}
                  onClick={() => setAttribute(name, undefined)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          <button
            className="text-xs text-muted-foreground hover:text-foreground underline ml-1 transition-colors"
            onClick={resetFilters}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
