"use client";

import { useEffect, useRef, useSyncExternalStore, useState } from "react";
import { SlidersHorizontal, Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useMarketplaceStore } from "@/stores";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { triggerHaptic } from "@/lib/utils/haptics";

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

function subscribeToHydrationState() {
  return () => {};
}

export function BusinessFilterDrawer() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
  const [open, setOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isInteractive = useSyncExternalStore(
    subscribeToHydrationState,
    () => true,
    () => false
  );
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setFilter("query", value || undefined),
    300
  );

  useEffect(() => {
    return () => debouncedSetQuery.cancel();
  }, [debouncedSetQuery]);

  const activeFilterCount = [
    filters.query,
    filters.businessCategory,
    filters.businessType,
    filters.province,
    filters.city,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    triggerHaptic("light");
    debouncedSetQuery.cancel();
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    resetFilters();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) triggerHaptic("medium");
        setOpen(next);
      }}
    >
      {/* ── Inline filter bar (mobile only) ─────────── */}
      <div className="lg:hidden">
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Open business filters"
            disabled={!isInteractive}
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Filter &amp; search businesses</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-blue px-1.5 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
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
          {/* Search */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                key={filters.query || "__empty-query__"}
                ref={searchInputRef}
                id="drawer-business-search"
                type="search"
                placeholder="Search businesses, services, or brands"
                aria-label="Search businesses"
                className="pl-9"
                defaultValue={filters.query || ""}
                disabled={!isInteractive}
                onChange={(event) => {
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

          {/* Business Type */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-type">Business Type</Label>
            <select
              id="drawer-business-type"
              aria-label="Business type"
              className={selectClassName}
              value={filters.businessType || ""}
              disabled={!isInteractive}
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

          {/* City (cascading) */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-city">City</Label>
            <select
              id="drawer-business-city"
              aria-label="City"
              className={selectClassName}
              value={filters.city || ""}
              onChange={(event) => setFilter("city", event.target.value || undefined)}
              disabled={!isInteractive || !filters.province}
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
              disabled={!isInteractive || activeFilterCount === 0}
            >
              Clear all
            </Button>
            <Button
              className="flex-1 bg-brand-blue hover:bg-brand-blue/90"
              disabled={!isInteractive}
              onClick={() => {
                triggerHaptic("success");
                setOpen(false);
              }}
            >
              View results
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
