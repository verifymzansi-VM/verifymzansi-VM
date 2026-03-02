"use client";

import { MapPin, ArrowUpDown, X, Briefcase } from "lucide-react";
import { useMarketplaceStore } from "@/stores";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_AD_CATEGORIES } from "@/lib/constants/categories";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function BusinessAdHeader() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
  const provinces = getProvinceNames();
  const cities = filters.province ? getCitiesForProvince(filters.province) : [];

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
      {/* Toolbar row with Blue Tint */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-brand-blue/5 border border-brand-blue/10 rounded-xl">
        <div className="flex items-center gap-1.5 text-brand-blue font-medium text-sm px-1">
          <Briefcase className="h-4 w-4" />
          <span>Find Services:</span>
        </div>

        <div className="flex flex-1 items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 max-w-[200px]">
            <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <select
              aria-label="Province"
              className="w-full rounded-md border border-brand-blue/20 bg-background pl-8 pr-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-blue shadow-sm appearance-none"
              value={filters.province || ""}
              onChange={(e) => setFilter("province", e.target.value || undefined)}
            >
              <option value="">All Provinces</option>
              {provinces.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {filters.province && cities.length > 0 && (
            <select
              aria-label="City"
              className="flex-1 max-w-[160px] rounded-md border border-brand-blue/20 bg-background px-2.5 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-blue shadow-sm animate-in fade-in-0 duration-200"
              value={filters.city || ""}
              onChange={(e) => setFilter("city", e.target.value || undefined)}
            >
              <option value="">All Cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center justify-end gap-1.5 text-muted-foreground sm:border-l sm:pl-3 w-full sm:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs font-medium text-foreground outline-none border-none hover:text-brand-blue bg-transparent transition-colors">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
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
        <div className="flex flex-wrap items-center gap-1.5 px-1 animate-in slide-in-from-top-1 fade-in-50 duration-200">
          {filters.category && (
            <Badge
              variant="outline"
              className="gap-1 text-xs px-2.5 py-1 rounded-md border-brand-blue bg-brand-blue/10 text-brand-blue-700 dark:text-brand-blue-400 font-medium"
            >
              {BUSINESS_AD_CATEGORIES.find((c) => c.value === filters.category)?.label ||
                filters.category.replace(/_/g, " ")}
              <button
                aria-label="Remove category filter"
                onClick={() => setFilter("category", undefined)}
                className="ml-1 rounded-full p-0.5 hover:bg-brand-blue/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.province && (
            <Badge
              variant="outline"
              className="gap-1 text-xs px-2.5 py-1 rounded-md border-brand-blue/30 bg-background text-foreground shadow-sm"
            >
              <MapPin className="w-3 h-3 text-brand-blue mr-0.5" />
              {filters.province}
              {filters.city && <span className="text-muted-foreground px-1">›</span>}
              {filters.city && filters.city}
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
            className="text-xs text-muted-foreground hover:text-brand-blue underline ml-2 transition-colors"
            onClick={resetFilters}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
