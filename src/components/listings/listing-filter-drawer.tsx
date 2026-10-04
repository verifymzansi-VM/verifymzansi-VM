"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FilterEdgeTab } from "./filter-edge-tab";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { LISTING_CONDITIONS, getListingConditionLabel } from "@/lib/constants/listing-condition";
import { cloneMarketplaceFilters, useMarketplaceStore, type MarketplaceFilters } from "@/stores";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/utils/haptics";
import { ListingAttributeFilters } from "./listing-attribute-filters";
import { ActiveFilterChips, type FilterChip } from "./active-filter-chips";
import {
  FilterChoiceChip,
  describeAttributeFilter,
  filterSelectClass,
  formatPriceRangeLabel,
} from "./filter-controls";

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
  const [draftFilters, setDraftFilters] = useState<MarketplaceFilters>(() =>
    cloneMarketplaceFilters(filters)
  );

  const appliedFilterCount = countActiveFilters(filters);
  const draftFilterCount = countActiveFilters(draftFilters);

  const selectClass = filterSelectClass;

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

  function updateDraftAttribute(name: string, value: string | boolean | string[] | undefined) {
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

  /* ── Build active-filter chips for the strip ───────── */
  const activeChips: FilterChip[] = [];
  if (filters.query) {
    activeChips.push({
      key: "query",
      label: filters.query,
      onRemove: () => replaceFilters({ ...filters, query: undefined }),
    });
  }
  if (filters.category) {
    const catLabel =
      CATEGORIES.find((c) => c.value === filters.category)?.label ||
      filters.category.replace(/_/g, " ");
    activeChips.push({
      key: "category",
      label: catLabel,
      onRemove: () => replaceFilters({ ...filters, category: undefined, attributes: {} }),
    });
  }
  if (filters.province) {
    const locLabel = filters.city ? `${filters.city}, ${filters.province}` : filters.province;
    activeChips.push({
      key: "location",
      label: locLabel,
      onRemove: () => replaceFilters({ ...filters, province: undefined, city: undefined }),
    });
  }
  if (filters.condition) {
    activeChips.push({
      key: "condition",
      label: getListingConditionLabel(filters.condition) || filters.condition,
      onRemove: () => replaceFilters({ ...filters, condition: undefined }),
    });
  }
  if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
    activeChips.push({
      key: "price",
      label: formatPriceRangeLabel(filters.priceMin, filters.priceMax),
      onRemove: () => replaceFilters({ ...filters, priceMin: undefined, priceMax: undefined }),
    });
  }
  for (const [name, val] of Object.entries(filters.attributes)) {
    if (val !== undefined && val !== "") {
      activeChips.push({
        key: `attr-${name}`,
        label: describeAttributeFilter(filters.category, name, val),
        onRemove: () => {
          const next = { ...filters.attributes };
          delete next[name];
          replaceFilters({ ...filters, attributes: next });
        },
      });
    }
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
      {/* ── Active filter chips (mobile only, inline) ── */}
      <div className="lg:hidden">
        <ActiveFilterChips
          chips={activeChips}
          onClearAll={() => {
            triggerHaptic("light");
            replaceFilters(cloneMarketplaceFilters());
          }}
        />
      </div>

      {/* ── Filters on the right wall (phones and tablets) ── */}
      <FilterEdgeTab
        label="Open listing filters"
        count={appliedFilterCount}
        open={open}
        onOpen={() => {
          triggerHaptic("medium");
          setDraftFilters(cloneMarketplaceFilters(filters));
          setOpen(true);
        }}
      />

      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-3xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
        <SheetHeader className="flex flex-row items-center justify-between pb-3">
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

        <div className="space-y-3 pb-20">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Search</Label>
            <div className="relative" role="search">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search listings"
                aria-label="Search listings"
                enterKeyHint="search"
                className="h-11 rounded-xl pl-9"
                value={draftFilters.query || ""}
                onChange={(event) => updateDraftFilter("query", event.target.value || undefined)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Category</Label>
            <select
              aria-label="Category"
              className={selectClass}
              value={draftFilters.category || ""}
              onChange={(event) => updateDraftFilter("category", event.target.value || undefined)}
            >
              <option value="">All categories</option>
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

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Location</Label>
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
                {draftFilters.province ? "All cities" : "Choose a province first"}
              </option>
              {draftFilters.province &&
                getCitiesForProvince(draftFilters.province).map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Price (R)</Label>
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

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Condition</Label>
            <div className="flex flex-wrap gap-2">
              {LISTING_CONDITIONS.map((condition) => (
                <FilterChoiceChip
                  key={condition.value}
                  selected={draftFilters.condition === condition.value}
                  onClick={() =>
                    updateDraftFilter(
                      "condition",
                      draftFilters.condition === condition.value ? undefined : condition.value
                    )
                  }
                >
                  {condition.label}
                </FilterChoiceChip>
              ))}
            </div>
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 border-t border-border/70 bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:pb-3">
          <Button className="w-full elev-xs" size="lg" onClick={handleApply}>
            Show results
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
