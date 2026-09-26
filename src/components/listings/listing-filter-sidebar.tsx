"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { useMarketplaceStore } from "@/stores";
import { cn } from "@/lib/utils";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { ListingAttributeFilters } from "./listing-attribute-filters";
import {
  FilterChoiceChip,
  FilterField,
  FilterPanel,
  filterInputClass,
  filterSelectClass,
} from "./filter-controls";

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

  const priceRangeInvalid =
    filters.priceMin != null && filters.priceMax != null && filters.priceMin > filters.priceMax;

  return (
    <FilterPanel
      title="Filters"
      action={
        hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 -mt-1 h-9 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => {
              debouncedSetQuery.cancel();
              setLocalQuery("");
              resetFilters();
            }}
          >
            Clear all
          </Button>
        ) : null
      }
    >
      <div className="relative" role="search">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search listings"
          aria-label="Search listings"
          enterKeyHint="search"
          className={cn(filterInputClass, "pl-9")}
          value={localQuery}
          onChange={(e) => {
            setLocalQuery(e.target.value);
            debouncedSetQuery(e.target.value);
          }}
        />
      </div>

      <FilterField label="Category" htmlFor="market-sidebar-category">
        <select
          id="market-sidebar-category"
          className={filterSelectClass}
          value={filters.category || ""}
          onChange={(e) => setFilter("category", e.target.value || undefined)}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat.value} value={cat.value}>
              {cat.label}
            </option>
          ))}
        </select>
      </FilterField>

      <ListingAttributeFilters
        category={filters.category}
        attributes={filters.attributes}
        density="sidebar"
        onAttributeChange={setAttribute}
      />

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium text-foreground">Location</legend>
        <select
          aria-label="Province"
          className={filterSelectClass}
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
          className={filterSelectClass}
          value={filters.city || ""}
          onChange={(e) => setFilter("city", e.target.value || undefined)}
          disabled={!filters.province}
        >
          <option value="">{filters.province ? "All cities" : "Choose a province first"}</option>
          {filters.province &&
            getCitiesForProvince(filters.province).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
        </select>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-sm font-medium text-foreground">Price (R)</legend>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Min"
            aria-label="Minimum price"
            aria-invalid={priceRangeInvalid || undefined}
            aria-describedby={priceRangeInvalid ? "market-sidebar-price-error" : undefined}
            className={filterInputClass}
            value={filters.priceMin || ""}
            onChange={(e) =>
              setFilter("priceMin", e.target.value ? Number(e.target.value) : undefined)
            }
          />
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            to
          </span>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            placeholder="Max"
            aria-label="Maximum price"
            aria-invalid={priceRangeInvalid || undefined}
            aria-describedby={priceRangeInvalid ? "market-sidebar-price-error" : undefined}
            className={filterInputClass}
            value={filters.priceMax || ""}
            onChange={(e) =>
              setFilter("priceMax", e.target.value ? Number(e.target.value) : undefined)
            }
          />
        </div>
        {priceRangeInvalid ? (
          <p id="market-sidebar-price-error" className="text-xs text-destructive" role="alert">
            The minimum price is higher than the maximum. Swap them or clear one.
          </p>
        ) : null}
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-foreground">Condition</legend>
        <div className="flex flex-wrap gap-1.5">
          {LISTING_CONDITIONS.map((cond) => (
            <FilterChoiceChip
              key={cond.value}
              selected={filters.condition === cond.value}
              onClick={() =>
                setFilter("condition", filters.condition === cond.value ? undefined : cond.value)
              }
            >
              {cond.label}
            </FilterChoiceChip>
          ))}
        </div>
      </fieldset>
    </FilterPanel>
  );
}
