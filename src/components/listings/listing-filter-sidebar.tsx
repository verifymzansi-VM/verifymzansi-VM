"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
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

  const hasActiveFilters =
    filters.category ||
    filters.province ||
    filters.city ||
    filters.priceMin ||
    filters.priceMax ||
    filters.condition ||
    filters.query ||
    Object.values(filters.attributes).some((v) => v !== undefined && v !== "");

  return (
    <div className="space-y-4">
      {/* ── Search ────────────────────────────────────── */}
      <div className="relative" role="search">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search listings..."
          aria-label="Search listings"
          enterKeyHint="search"
          className="pl-9"
          value={localQuery}
          onChange={(e) => {
            setLocalQuery(e.target.value);
            debouncedSetQuery(e.target.value);
          }}
        />
      </div>

      {/* ── Category ───────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Category</Label>
        <select
          aria-label="Category"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Location</Label>
        <select
          aria-label="Province"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
            "w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
      </div>

      {/* ── Dynamic Category Attributes ────────────── */}
      <ListingAttributeFilters
        category={filters.category}
        attributes={filters.attributes}
        density="sidebar"
        onAttributeChange={setAttribute}
      />

      {/* ── Price range ───────────────────────────── */}
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
            value={filters.priceMin || ""}
            onChange={(e) =>
              setFilter("priceMin", e.target.value ? Number(e.target.value) : undefined)
            }
          />
          <span className="text-muted-foreground text-xs">–</span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Max"
            aria-label="Maximum price"
            className="text-sm"
            value={filters.priceMax || ""}
            onChange={(e) =>
              setFilter("priceMax", e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </div>
        {filters.priceMin != null &&
          filters.priceMax != null &&
          filters.priceMin > filters.priceMax && (
            <p className="text-xs text-destructive" role="alert">
              Min price must be less than max
            </p>
          )}
      </div>

      {/* ── Condition ──────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Condition</Label>
        <div className="flex gap-2">
          {LISTING_CONDITIONS.map((cond) => (
            <button
              key={cond.value}
              type="button"
              onClick={() =>
                setFilter("condition", filters.condition === cond.value ? undefined : cond.value)
              }
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                filters.condition === cond.value
                  ? "border-brand-green bg-brand-green/10 text-brand-green"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
              )}
            >
              {cond.label}
            </button>
          ))}
        </div>
      </div>

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
