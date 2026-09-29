"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { useMarketplaceStore } from "@/stores";
import { cn } from "@/lib/utils";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingAttributeFilters } from "./listing-attribute-filters";

/* ─── Main Component ───────────────────────────────────────── */

export function ListingFilterSidebar() {
  const { filters, setFilter, setAttribute, resetFilters } = useMarketplaceStore();

  // Debounced search: instant keystroke feedback, deferred store update
  const [localQuery, setLocalQuery] = useState(filters.query || "");
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setFilter("query", value || undefined),
    300
  );

  // Keep the box in step with query changes made elsewhere: URL hydration after
  // mount (deep links, back/forward), chip removal and "Clear all" in the grid header.
  const [syncedQuery, setSyncedQuery] = useState(filters.query);
  if (filters.query !== syncedQuery) {
    setSyncedQuery(filters.query);
    if ((filters.query ?? "") !== localQuery) setLocalQuery(filters.query ?? "");
  }
  // A query cleared elsewhere must not be re-applied by a keystroke still in flight.
  useEffect(() => {
    if (!filters.query) debouncedSetQuery.cancel();
  }, [filters.query, debouncedSetQuery]);

  const priceRangeInvalid =
    filters.priceMin != null && filters.priceMax != null && filters.priceMin > filters.priceMax;

  const hasActiveFilters =
    filters.category ||
    filters.province ||
    filters.city ||
    filters.priceMin ||
    filters.priceMax ||
    filters.condition ||
    filters.query ||
    Object.values(filters.attributes).some(
      (v) => v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
    );

  return (
    <div className="space-y-5 rounded-2xl border border-border/70 bg-card p-4 elev-xs">
      {/* ── Panel header ────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-border/60 pb-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-green/10 text-brand-green">
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </span>
        <p className="font-display text-sm font-semibold tracking-tight">Refine results</p>
      </div>

      {/* ── Search ────────────────────────────────────── */}
      <div className="relative" role="search">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search listings..."
          aria-label="Search listings"
          enterKeyHint="search"
          className="rounded-xl pl-9"
          value={localQuery}
          onChange={(e) => {
            setLocalQuery(e.target.value);
            debouncedSetQuery(e.target.value);
          }}
        />
      </div>

      {/* ── Category ───────────────────────────────── */}
      <div className="space-y-2">
        <Label htmlFor="market-sidebar-category" className="text-sm font-semibold">
          Category
        </Label>
        <select
          id="market-sidebar-category"
          className="h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs ring-offset-background transition-colors hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={filters.category || ""}
          onChange={(e) => setFilter("category", e.target.value || undefined)}
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Location ────────────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold leading-none">Location</legend>
        <select
          aria-label="Province"
          className="h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs ring-offset-background transition-colors hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          value={filters.province || ""}
          onChange={(e) => {
            setFilter("province", e.target.value || undefined);
            setFilter("city", undefined);
          }}
        >
          <option value="">All provinces</option>
          {getProvinceNames().map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          aria-label="City"
          className={cn(
            "h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-xs ring-offset-background transition-colors hover:border-brand-green/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            !filters.province && "opacity-50"
          )}
          value={filters.city || ""}
          onChange={(e) => setFilter("city", e.target.value || undefined)}
          disabled={!filters.province}
        >
          <option value="">{filters.province ? "All cities" : "Select province first"}</option>
          {filters.province &&
            getCitiesForProvince(filters.province).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
        </select>
      </fieldset>

      {/* ── Dynamic Category Attributes ────────────── */}
      <ListingAttributeFilters
        category={filters.category}
        attributes={filters.attributes}
        density="sidebar"
        onAttributeChange={setAttribute}
      />

      {/* ── Price range ───────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold leading-none">Price range (ZAR)</legend>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Min"
            aria-label="Minimum price"
            aria-invalid={priceRangeInvalid || undefined}
            aria-describedby={priceRangeInvalid ? "market-sidebar-price-error" : undefined}
            className="text-sm"
            value={filters.priceMin || ""}
            onChange={(e) =>
              setFilter("priceMin", e.target.value ? Number(e.target.value) : undefined)
            }
          />
          <span className="text-muted-foreground text-xs" aria-hidden="true">
            –
          </span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Max"
            aria-label="Maximum price"
            aria-invalid={priceRangeInvalid || undefined}
            aria-describedby={priceRangeInvalid ? "market-sidebar-price-error" : undefined}
            className="text-sm"
            value={filters.priceMax || ""}
            onChange={(e) =>
              setFilter("priceMax", e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </div>
        {priceRangeInvalid && (
          <p id="market-sidebar-price-error" className="text-xs text-destructive" role="alert">
            Min price must be less than max
          </p>
        )}
      </fieldset>

      {/* ── Condition ──────────────────────────────── */}
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold leading-none">Condition</legend>
        <div className="flex flex-wrap gap-2">
          {LISTING_CONDITIONS.map((cond) => (
            <button
              key={cond.value}
              type="button"
              aria-pressed={filters.condition === cond.value}
              onClick={() =>
                setFilter("condition", filters.condition === cond.value ? undefined : cond.value)
              }
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-[0.97] motion-reduce:transition-none",
                filters.condition === cond.value
                  ? "border-brand-green bg-brand-green/10 text-brand-green shadow-xs"
                  : "border-border/80 text-muted-foreground hover:text-foreground hover:border-brand-green/40 hover:bg-brand-green/5"
              )}
            >
              {cond.label}
            </button>
          ))}
        </div>
      </fieldset>

      {/* ── Reset Button ─────────────────────────── */}
      {hasActiveFilters && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => {
            debouncedSetQuery.cancel();
            setLocalQuery("");
            resetFilters();
          }}
        >
          <X className="mr-1 h-3 w-3" />
          Clear all filters
        </Button>
      )}
    </div>
  );
}
