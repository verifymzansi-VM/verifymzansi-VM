"use client";

import { useState } from "react";
import { SlidersHorizontal, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarketplaceSectionNav } from "@/components/layout/marketplace-section-nav";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useMarketplaceStore } from "@/stores";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function BusinessFilterDrawer() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
  const [localQuery, setLocalQuery] = useState(filters.query || "");

  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setFilter("query", value || undefined),
    300
  );

  const [prevStoreQuery, setPrevStoreQuery] = useState(filters.query);

  if (filters.query !== prevStoreQuery) {
    debouncedSetQuery.cancel();
    setPrevStoreQuery(filters.query);
    setLocalQuery(filters.query || "");
  }

  const activeFilterCount = [
    filters.query,
    filters.businessCategory,
    filters.businessType,
    filters.province,
    filters.city,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    debouncedSetQuery.cancel();
    setLocalQuery("");
    resetFilters();
  };

  return (
    <Sheet>
      <div className="fixed bottom-20 right-4 z-40 lg:hidden">
        <SheetTrigger asChild>
          <Button
            size="lg"
            className="rounded-full shadow-lg h-14 w-14 bg-brand-blue hover:bg-brand-blue/90"
            aria-label="Open business filters"
          >
            <SlidersHorizontal className="h-5 w-5" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
      </div>

      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="mb-4">
          <SheetTitle>Filter Businesses</SheetTitle>
          <SheetDescription>
            Search and narrow the business list without leaving the page.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          <MarketplaceSectionNav
            variant="mobile"
            heading="Browse marketplace sections"
            description="Switch between market, business, promotions, and events without losing your place in the mobile flow."
            className="border-none bg-transparent p-0 shadow-none"
          />

          {/* Search */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="drawer-business-search"
                type="search"
                placeholder="Search businesses, services, or brands"
                aria-label="Search businesses"
                className="pl-9"
                value={localQuery}
                onChange={(event) => {
                  setLocalQuery(event.target.value);
                  debouncedSetQuery(event.target.value);
                }}
              />
            </div>
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-category">Category</Label>
            <select
              id="drawer-business-category"
              aria-label="Category"
              className={selectClassName}
              value={filters.businessCategory || ""}
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

          {/* Business Type */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-type">Business Type</Label>
            <select
              id="drawer-business-type"
              aria-label="Business type"
              className={selectClassName}
              value={filters.businessType || ""}
              onChange={(event) =>
                setFilter(
                  "businessType",
                  event.target.value
                    ? (event.target.value as typeof filters.businessType)
                    : undefined
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

          {/* Province */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-province">Province</Label>
            <select
              id="drawer-business-province"
              aria-label="Province"
              className={selectClassName}
              value={filters.province || ""}
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

          {/* City (cascading) */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-city">City</Label>
            <select
              id="drawer-business-city"
              aria-label="City"
              className={selectClassName}
              value={filters.city || ""}
              onChange={(event) => setFilter("city", event.target.value || undefined)}
              disabled={!filters.province}
            >
              <option value="">All cities</option>
              {filters.province &&
                getCitiesForProvince(filters.province).map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
            </select>
          </div>
          {/* Actions */}
          <div className="sticky bottom-0 flex gap-3 border-t bg-background/95 px-0 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-4 backdrop-blur">
            <Button
              variant="outline"
              className="flex-1"
              onClick={clearAllFilters}
              disabled={activeFilterCount === 0}
            >
              Clear all
            </Button>
            <SheetClose asChild>
              <Button className="flex-1 bg-brand-blue hover:bg-brand-blue/90">View results</Button>
            </SheetClose>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
