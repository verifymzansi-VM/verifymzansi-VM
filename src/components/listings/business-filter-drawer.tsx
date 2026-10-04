"use client";

import { FilterEdgeTab } from "./filter-edge-tab";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useMarketplaceStore } from "@/stores";
import {
  ALL_BUSINESS_CATEGORIES,
  BUSINESS_CATEGORIES,
  BUSINESS_TYPE_OPTIONS,
} from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { triggerHaptic } from "@/lib/utils/haptics";
import { useHydrated } from "@/hooks/use-hydrated";
import { useFilterOrganisations } from "@/hooks/use-filter-organisations";
import { ActiveFilterChips, type FilterChip } from "./active-filter-chips";
import { filterSelectClass } from "./filter-controls";

const selectClassName = filterSelectClass;

export function BusinessFilterDrawer() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
  const [open, setOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isInteractive = useHydrated();
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
    filters.businessSubcategory,
    filters.businessType,
    filters.province,
    filters.city,
    filters.organisation,
  ].filter(Boolean).length;
  const organisations = useFilterOrganisations(open || Boolean(filters.organisation));

  // The search box is uncontrolled so typing never remounts it (a query-based
  // key dropped focus after every debounced commit). Mirror query changes made
  // elsewhere (URL hydration, chips, clear all) without touching it mid-typing.
  useEffect(() => {
    const input = searchInputRef.current;
    const query = filters.query ?? "";
    if (input && document.activeElement !== input && input.value !== query) {
      input.value = query;
    }
  }, [filters.query]);

  const clearAllFilters = () => {
    triggerHaptic("light");
    debouncedSetQuery.cancel();
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    resetFilters();
  };

  /* ── Build active-filter chips for the strip ───────── */
  const activeChips: FilterChip[] = [];
  if (filters.query) {
    activeChips.push({
      key: "query",
      label: filters.query,
      onRemove: () => setFilter("query", undefined),
    });
  }
  if (filters.businessCategory) {
    const catLabel =
      (ALL_BUSINESS_CATEGORIES.find((c) => c.value === filters.businessCategory)?.label ||
        String(filters.businessCategory).replace(/_/g, " ")) +
      (BUSINESS_CATEGORIES.some((c) => c.value === filters.businessCategory)
        ? ""
        : " (previous category)");
    activeChips.push({
      key: "category",
      label: catLabel,
      onRemove: () => setFilter("businessCategory", undefined),
    });
  }
  if (filters.businessSubcategory) {
    const catDef = ALL_BUSINESS_CATEGORIES.find((c) => c.value === filters.businessCategory);
    const subLabel =
      catDef?.subcategories.find((s) => s.value === filters.businessSubcategory)?.label ||
      String(filters.businessSubcategory).replace(/_/g, " ");
    activeChips.push({
      key: "subcategory",
      label: subLabel,
      onRemove: () => setFilter("businessSubcategory", undefined),
    });
  }
  if (filters.businessType) {
    const typeLabel = `${
      BUSINESS_TYPE_OPTIONS.find((t) => t.value === filters.businessType)?.label ||
      String(filters.businessType).replace(/_/g, " ")
    } (previous filter)`;
    activeChips.push({
      key: "type",
      label: typeLabel,
      onRemove: () => setFilter("businessType", undefined),
    });
  }
  if (filters.province) {
    const locLabel = filters.city ? `${filters.city}, ${filters.province}` : filters.province;
    activeChips.push({
      key: "location",
      label: locLabel,
      onRemove: () => {
        setFilter("province", undefined);
        setFilter("city", undefined);
      },
    });
  }

  if (filters.organisation) {
    activeChips.push({
      key: "organisation",
      label:
        organisations.find((org) => org.slug === filters.organisation)?.name ??
        filters.organisation.replace(/-/g, " "),
      onRemove: () => setFilter("organisation", undefined),
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) triggerHaptic("medium");
        setOpen(next);
      }}
    >
      {/* ── Active filter chips (mobile only, inline) ── */}
      <div className="lg:hidden">
        <ActiveFilterChips chips={activeChips} onClearAll={clearAllFilters} />
      </div>

      {/* ── Filters on the right wall (phones and tablets) ── */}
      <FilterEdgeTab
        label="Open business filters"
        count={activeFilterCount}
        open={open}
        onOpen={() => {
          triggerHaptic("medium");
          setOpen(true);
        }}
      />

      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-3xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
        <SheetHeader className="mb-3">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription className="sr-only">Narrow the business list.</SheetDescription>
        </SheetHeader>

        <div className="space-y-3">
          {/* Search */}
          <div className="space-y-1.5">
            <Label htmlFor="drawer-business-search">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                id="drawer-business-search"
                type="search"
                placeholder="Name, service or brand"
                aria-label="Search businesses"
                className="h-11 rounded-xl pl-9"
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
              {filters.businessCategory &&
                !BUSINESS_CATEGORIES.some((c) => c.value === filters.businessCategory) && (
                  <option value={filters.businessCategory}>
                    {ALL_BUSINESS_CATEGORIES.find((c) => c.value === filters.businessCategory)
                      ?.label ?? filters.businessCategory}{" "}
                    (previous category)
                  </option>
                )}
              {BUSINESS_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          {/* Subcategory (cascading from category) */}
          {filters.businessCategory &&
            (() => {
              const catDef = ALL_BUSINESS_CATEGORIES.find(
                (c) => c.value === filters.businessCategory
              );
              const subs = catDef?.subcategories ?? [];
              if (subs.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  <Label htmlFor="drawer-business-subcategory">Specific business activity</Label>
                  <select
                    id="drawer-business-subcategory"
                    aria-label="Specific business activity"
                    className={selectClassName}
                    value={filters.businessSubcategory || ""}
                    disabled={!isInteractive}
                    onChange={(event) =>
                      setFilter("businessSubcategory", event.target.value || undefined)
                    }
                  >
                    <option value="">All activities</option>
                    {subs.map((sub) => (
                      <option key={sub.value} value={sub.value}>
                        {sub.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}

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
            <Label htmlFor="drawer-business-city">City or town</Label>
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
          {/* Organisation / programme (optional; never changes ranking) */}
          {organisations.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="drawer-business-organisation">Programme partner</Label>
              <select
                id="drawer-business-organisation"
                aria-label="Programme partner"
                className={selectClassName}
                value={filters.organisation || ""}
                onChange={(event) => setFilter("organisation", event.target.value || undefined)}
                disabled={!isInteractive}
              >
                <option value="">All businesses</option>
                {organisations.map((org) => (
                  <option key={org.slug} value={org.slug}>
                    {org.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
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
              className="flex-1"
              disabled={!isInteractive}
              onClick={() => {
                triggerHaptic("success");
                setOpen(false);
              }}
            >
              Show results
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
