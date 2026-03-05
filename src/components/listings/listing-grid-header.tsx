"use client";

import { ArrowUpDown, X } from "lucide-react";
import { useMarketplaceStore } from "@/stores";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES, BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ListingGridHeader() {
  const { filters, setFilter, setAttribute, resetFilters } = useMarketplaceStore();

  const sortOptions = [
    { value: "newest", label: "Recently posted" },
    { value: "price_asc", label: "Price: Low → High" },
    { value: "price_desc", label: "Price: High → Low" },
    { value: "popular", label: "Most popular" },
  ];
  const currentSortLabel =
    sortOptions.find((o) => o.value === filters.sort)?.label || "Recently posted";

  const hasActiveFilters =
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
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-1.5 text-xs font-medium text-foreground outline-none border-none hover:text-brand-green bg-transparent transition-colors">
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
        <div className="flex flex-wrap items-center gap-1.5">
          {filters.category && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              {[...CATEGORIES, ...BUSINESS_CATEGORIES].find((c) => c.value === filters.category)
                ?.label || filters.category.replace(/_/g, " ")}
              <X
                className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                onClick={() => setFilter("category", undefined)}
              />
            </Badge>
          )}
          {filters.province && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              {filters.province}
              {filters.city && ` › ${filters.city}`}
              <X
                className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                onClick={() => setFilter("province", undefined)}
              />
            </Badge>
          )}
          {(filters.priceMin || filters.priceMax) && (
            <Badge variant="secondary" className="gap-1 text-xs px-2 py-0.5 rounded-md">
              R{filters.priceMin || 0} – R{filters.priceMax || "∞"}
              <X
                className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                onClick={() => {
                  setFilter("priceMin", undefined);
                  setFilter("priceMax", undefined);
                }}
              />
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
                <X
                  className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
                  onClick={() => setAttribute(name, undefined)}
                />
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
