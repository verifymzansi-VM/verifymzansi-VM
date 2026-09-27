"use client";

import { useEffect, useRef, useState } from "react";
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
import { useHydrated } from "@/hooks/use-hydrated";
import { ActiveFilterChips, type FilterChip } from "./active-filter-chips";

const selectClassName =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors hover:border-brand-blue/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/** Listed organisations for the optional programme filter (loaded on demand). */
function useFilterOrganisations(enabled: boolean): Array<{ slug: string; name: string }> {
  const [organisations, setOrganisations] = useState<Array<{ slug: string; name: string }>>([]);
  useEffect(() => {
    if (!enabled || organisations.length > 0) return;
    const controller = new AbortController();
    fetch("/api/organisations/search?purpose=filter", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { organisations: [] }))
      .then((data: { organisations?: Array<{ slug: string; name: string }> }) =>
        setOrganisations((data.organisations ?? []).map(({ slug, name }) => ({ slug, name })))
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled, organisations.length]);
  return organisations;
}

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
      BUSINESS_CATEGORIES.find((c) => c.value === filters.businessCategory)?.label ||
      String(filters.businessCategory).replace(/_/g, " ");
    activeChips.push({
      key: "category",
      label: catLabel,
      onRemove: () => setFilter("businessCategory", undefined),
    });
  }
  if (filters.businessSubcategory) {
    const catDef = BUSINESS_CATEGORIES.find((c) => c.value === filters.businessCategory);
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
    const typeLabel =
      BUSINESS_TYPE_OPTIONS.find((t) => t.value === filters.businessType)?.label ||
      String(filters.businessType).replace(/_/g, " ");
    activeChips.push({
      key: "type",
      label: typeLabel,
      onRemove: () => setFilter("businessType", undefined),
    });
  }
  if (filters.province) {
    const locLabel = filters.city ? `${filters.province} › ${filters.city}` : filters.province;
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

      {/* ── Sticky FAB filter button (mobile only) ── */}
      <SheetTrigger asChild>
        <button
          type="button"
          className="fixed bottom-0 left-1/2 z-40 inline-flex h-12 w-12 -translate-x-1/2 items-center justify-center gap-1 rounded-full bg-brand-blue text-white shadow-lg shadow-brand-blue/30 ring-1 ring-white/20 transition-all hover:bg-brand-blue/90 active:scale-95 md:hidden motion-reduce:transition-none motion-reduce:active:scale-100"
          aria-label="Open business filters"
          disabled={!isInteractive}
        >
          <SlidersHorizontal className="h-4 w-4 shrink-0" />
          {activeFilterCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-gold px-1 text-[10px] font-bold text-warm-950 ring-2 ring-background">
              {activeFilterCount}
            </span>
          )}
        </button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-3xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border" aria-hidden="true" />
        <SheetHeader className="mb-3">
          <SheetTitle>Filter Businesses</SheetTitle>
          <SheetDescription>
            Search and narrow the business list without leaving the page.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3">
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
                className="rounded-xl pl-9"
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

          {/* Subcategory (cascading from category) */}
          {filters.businessCategory &&
            (() => {
              const catDef = BUSINESS_CATEGORIES.find((c) => c.value === filters.businessCategory);
              const subs = catDef?.subcategories ?? [];
              if (subs.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  <Label htmlFor="drawer-business-subcategory">Subcategory</Label>
                  <select
                    id="drawer-business-subcategory"
                    aria-label="Subcategory"
                    className={selectClassName}
                    value={filters.businessSubcategory || ""}
                    disabled={!isInteractive}
                    onChange={(event) =>
                      setFilter("businessSubcategory", event.target.value || undefined)
                    }
                  >
                    <option value="">All subcategories</option>
                    {subs.map((sub) => (
                      <option key={sub.value} value={sub.value}>
                        {sub.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}

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
          {/* Organisation / programme (optional; never changes ranking) */}
          {organisations.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="drawer-business-organisation">Organisation / Programme</Label>
              <select
                id="drawer-business-organisation"
                aria-label="Organisation or programme"
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
              View results
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
