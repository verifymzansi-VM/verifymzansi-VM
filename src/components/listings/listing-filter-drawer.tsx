"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { cloneMarketplaceFilters, useMarketplaceStore, type MarketplaceFilters } from "@/stores";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/utils/haptics";
import { useHydrated } from "@/hooks/use-hydrated";
import { ListingAttributeFilters } from "./listing-attribute-filters";

function countActiveFilters(
  filters: Pick<
    MarketplaceFilters,
    | "query"
    | "category"
    | "province"
    | "city"
    | "priceMin"
    | "priceMax"
    | "condition"
    | "attributes"
  >
) {
  let count = 0;
  if (filters.query) count++;
  if (filters.category) count++;
  if (filters.province) count++;
  if (filters.city) count++;
  if (filters.priceMin !== undefined) count++;
  if (filters.priceMax !== undefined) count++;
  if (filters.condition) count++;
  count += Object.values(filters.attributes).filter(
    (value) => value !== undefined && value !== ""
  ).length;
  return count;
}

export function ListingFilterDrawer() {
  const { filters, replaceFilters } = useMarketplaceStore();
  const [open, setOpen] = useState(false);
  const isHydrated = useHydrated();
  const [draftFilters, setDraftFilters] = useState<MarketplaceFilters>(() =>
    cloneMarketplaceFilters(filters)
  );

  const appliedFilterCount = countActiveFilters(filters);
  const draftFilterCount = countActiveFilters(draftFilters);

  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  function updateDraftFilter<K extends keyof MarketplaceFilters>(
    key: K,
    value: MarketplaceFilters[K]
  ) {
    setDraftFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "category") {
        next.attributes = {};
      }
      if (key === "province") {
        next.city = undefined;
      }
      return next;
    });
  }

  function updateDraftAttribute(name: string, value: string | boolean | undefined) {
    setDraftFilters((current) => ({
      ...current,
      attributes: { ...current.attributes, [name]: value },
    }));
  }

  function clearDraftFilters() {
    triggerHaptic("light");
    setDraftFilters(cloneMarketplaceFilters());
  }

  function handleApply() {
    triggerHaptic("success");
    replaceFilters(draftFilters);
    setOpen(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          triggerHaptic("medium");
          setDraftFilters(cloneMarketplaceFilters(filters));
        }
        setOpen(nextOpen);
      }}
    >
      <div className="lg:hidden">
        {isHydrated ? (
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Open listing filters"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Filter &amp; search listings</span>
              {appliedFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {appliedFilterCount}
                </span>
              )}
            </button>
          </SheetTrigger>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground shadow-sm"
            aria-label="Open listing filters"
            disabled
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Filter &amp; search listings</span>
            {appliedFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {appliedFilterCount}
              </span>
            )}
          </button>
        )}
      </div>

      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="flex flex-row items-center justify-between pb-4">
          <SheetTitle>Filters</SheetTitle>
          {draftFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={clearDraftFilters}
            >
              <X className="mr-1 h-3 w-3" />
              Clear all
            </Button>
          )}
        </SheetHeader>

        <div className="space-y-5 pb-20">
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Search</Label>
            <div className="relative" role="search">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search listings..."
                aria-label="Search listings"
                enterKeyHint="search"
                className="pl-9"
                value={draftFilters.query || ""}
                onChange={(event) => updateDraftFilter("query", event.target.value || undefined)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Category</Label>
            <select
              aria-label="Category"
              className={selectClass}
              value={draftFilters.category || ""}
              onChange={(event) => updateDraftFilter("category", event.target.value || undefined)}
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <ListingAttributeFilters
            category={draftFilters.category}
            attributes={draftFilters.attributes}
            density="drawer"
            onAttributeChange={updateDraftAttribute}
          />

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Location</Label>
            <select
              aria-label="Province"
              className={selectClass}
              value={draftFilters.province || ""}
              onChange={(event) => updateDraftFilter("province", event.target.value || undefined)}
            >
              <option value="">All provinces</option>
              {getProvinceNames().map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
            <select
              aria-label="City"
              className={cn(selectClass, !draftFilters.province && "opacity-50")}
              value={draftFilters.city || ""}
              onChange={(event) => updateDraftFilter("city", event.target.value || undefined)}
              disabled={!draftFilters.province}
            >
              <option value="">
                {draftFilters.province ? "All cities" : "Select province first"}
              </option>
              {draftFilters.province &&
                getCitiesForProvince(draftFilters.province).map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Price range (ZAR)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Min"
                aria-label="Minimum price"
                className="text-sm"
                value={draftFilters.priceMin ?? ""}
                onChange={(event) =>
                  updateDraftFilter(
                    "priceMin",
                    event.target.value ? Number(event.target.value) : undefined
                  )
                }
              />
              <span className="text-muted-foreground text-xs shrink-0">&ndash;</span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Max"
                aria-label="Maximum price"
                className="text-sm"
                value={draftFilters.priceMax ?? ""}
                onChange={(event) =>
                  updateDraftFilter(
                    "priceMax",
                    event.target.value ? Number(event.target.value) : undefined
                  )
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold">Condition</Label>
            <div className="flex flex-wrap gap-2">
              {LISTING_CONDITIONS.map((condition) => (
                <button
                  key={condition.value}
                  type="button"
                  onClick={() =>
                    updateDraftFilter(
                      "condition",
                      draftFilters.condition === condition.value ? undefined : condition.value
                    )
                  }
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    draftFilters.condition === condition.value
                      ? "border-brand-green bg-brand-green/10 text-brand-green"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                  )}
                >
                  {condition.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-4">
          <Button className="w-full" size="lg" onClick={handleApply}>
            Show results
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
