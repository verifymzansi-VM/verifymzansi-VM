"use client";

import { ArrowUpDown, X, Store } from "lucide-react";
import { useMarketplaceStore } from "@/stores";
import { Badge } from "@/components/ui/badge";
import { MALL_SHOP_CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function MallShopHeader() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();

  const sortOptions = [
    { value: "newest", label: "Recently posted" },
    { value: "price_asc", label: "Price: Low → High" },
    { value: "price_desc", label: "Price: High → Low" },
    { value: "popular", label: "Most popular" },
  ];
  const currentSortLabel =
    sortOptions.find((o) => o.value === filters.sort)?.label || "Recently posted";

  const hasActiveFilters = filters.category || filters.province || filters.city;

  return (
    <div className="space-y-4 mb-6">
      {/* Toolbar row with Gold Tint */}
      <div className="flex items-center justify-between gap-2 p-3 bg-brand-gold/5 border border-brand-gold/10 rounded-xl">
        <div className="flex items-center gap-1.5 text-brand-gold-700 dark:text-brand-gold-400 font-medium text-sm">
          <Store className="h-4 w-4" />
          <span className="hidden sm:inline">Explore Malls</span>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-sm px-4">
          <select
            aria-label="Filter by Province"
            className="w-1/2 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-gold transition-shadow"
            value={filters.province || ""}
            onChange={(e) => setFilter("province", e.target.value || undefined)}
          >
            <option value="">All Provinces</option>
            {getProvinceNames().map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by City"
            className="w-1/2 bg-background border border-border rounded-md px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-gold transition-shadow disabled:opacity-50"
            value={filters.city || ""}
            onChange={(e) => setFilter("city", e.target.value || undefined)}
            disabled={!filters.province}
          >
            <option value="">All Cities</option>
            {filters.province &&
              getCitiesForProvince(filters.province).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 text-muted-foreground ml-auto border-l border-brand-gold/20 pl-3">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs font-medium text-foreground outline-none border-none hover:text-brand-gold bg-transparent transition-colors">
              <ArrowUpDown className="h-3.5 w-3.5 hidden sm:block text-muted-foreground" />
              {currentSortLabel}
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
        </div>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs text-muted-foreground mr-1">Active filters:</span>
          {filters.category && (
            <Badge
              variant="outline"
              className="gap-1 text-xs px-2.5 py-1 rounded-md border-brand-gold bg-brand-gold/10 text-brand-gold-700 dark:text-brand-gold-300"
            >
              {MALL_SHOP_CATEGORIES.find((c) => c.value === filters.category)?.label ||
                filters.category.replace(/_/g, " ")}
              <button
                aria-label="Remove category filter"
                onClick={() => setFilter("category", undefined)}
                className="ml-1 rounded-full p-0.5 hover:bg-brand-gold/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.province && (
            <Badge
              variant="outline"
              className="gap-1 text-xs px-2.5 py-1 rounded-md border-brand-gold/50 bg-brand-gold/5 text-foreground"
            >
              {filters.province}
              {filters.city && ` › ${filters.city}`}
              <button
                aria-label="Remove location filter"
                onClick={() => setFilter("province", undefined)}
                className="ml-1 rounded-full p-0.5 hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          <button
            className="text-xs text-muted-foreground hover:text-brand-gold underline ml-2 transition-colors"
            onClick={resetFilters}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
