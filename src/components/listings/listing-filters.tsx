"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CATEGORIES, type AttributeField } from "@/lib/constants/categories";
import { getModelsForMake } from "@/lib/constants/sa-vehicles";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { useMarketplaceStore } from "@/stores";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";

/* ─── Helpers ──────────────────────────────────────────────── */

function numberRangeOptions(field: AttributeField): string[] | null {
  const countable = ["bedrooms", "bathrooms", "parking_spots"];
  if (countable.includes(field.name)) {
    return ["1", "2", "3", "4", "5+"];
  }
  return null;
}

function resolveOption(option: string | { value: string; label: string }) {
  return typeof option === "string" ? { value: option, label: option } : option;
}

/* ─── Mobile Attribute Renderer ────────────────────────────── */

function MobileFilterAttribute({
  field,
  value,
  allAttributes,
  onChange,
}: {
  field: AttributeField;
  value: string | boolean | undefined;
  allAttributes: Record<string, string | boolean | undefined>;
  onChange: (value: string | boolean | undefined) => void;
}) {
  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  switch (field.type) {
    case "select": {
      // Resolve options dynamically for cascading selects
      let options = field.options ?? [];
      if (field.dependsOn === "make") {
        const parentMake = allAttributes["make"] as string;
        options = parentMake ? [...getModelsForMake(parentMake), "Other"] : [];
      }

      const parentValue = field.dependsOn ? allAttributes[field.dependsOn] : undefined;
      const isDisabled = field.dependsOn && !parentValue;

      return (
        <div className="space-y-1.5">
          <Label className="text-sm">{field.label}</Label>
          <select
            aria-label={field.label}
            className={selectClass}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            disabled={!!isDisabled}
          >
            <option value="">
              {isDisabled ? `Select ${field.dependsOn} first` : `Any ${field.label.toLowerCase()}`}
            </option>
            {options.map((opt) => {
              const resolved = resolveOption(opt);
              return (
                <option key={resolved.value} value={resolved.value}>
                  {resolved.label}
                </option>
              );
            })}
          </select>
        </div>
      );
    }

    case "number": {
      const rangeOpts = numberRangeOptions(field);
      if (rangeOpts) {
        return (
          <div className="space-y-1.5">
            <Label className="text-sm">
              {field.label}
              {field.unit ? ` (${field.unit})` : ""}
            </Label>
            <select
              aria-label={field.label}
              className={selectClass}
              value={(value as string) || ""}
              onChange={(e) => onChange(e.target.value || undefined)}
            >
              <option value="">Any</option>
              {rangeOpts.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        );
      }
      return (
        <div className="space-y-1.5">
          <Label className="text-sm">
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={field.placeholder || "Any"}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </div>
      );
    }

    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <input
            id={`mobile-filter-${field.name}`}
            type="checkbox"
            aria-label={field.label}
            className="h-4 w-4 rounded border-input text-brand-green focus:ring-brand-green"
            checked={(value as boolean) || false}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
          />
          <Label
            htmlFor={`mobile-filter-${field.name}`}
            className="cursor-pointer text-sm font-normal"
          >
            {field.label}
          </Label>
        </div>
      );

    case "text":
      return (
        <div className="space-y-1.5">
          <Label className="text-sm">{field.label}</Label>
          <Input
            type="text"
            placeholder={field.placeholder || `Any ${field.label.toLowerCase()}`}
            value={(value as string) || ""}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
        </div>
      );

    default:
      return null;
  }
}

/* ─── Main Component ───────────────────────────────────────── */

export function ListingFilters() {
  const { filters, setFilter, setAttribute, resetFilters } = useMarketplaceStore();
  const [filterOpen, setFilterOpen] = useState(false);
  const selectedCategory = CATEGORIES.find((c) => c.value === filters.category);

  const filterableAttributes =
    selectedCategory?.attributeFields.filter(
      (f) => f.type === "select" || f.type === "boolean" || f.type === "number" || f.type === "text"
    ) ?? [];

  // Debounced search: local state for instant keystroke feedback,
  // store update deferred by 300ms for fewer re-renders/queries
  const [localQuery, setLocalQuery] = useState(filters.query || "");
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setFilter("query", value || undefined),
    300
  );

  // Sync local state when store changes externally (e.g. URL sync, reset)
  // Uses the React-recommended "adjusting state during render" pattern
  // instead of useEffect to avoid cascading renders.
  const [prevStoreQuery, setPrevStoreQuery] = useState(filters.query);
  if (filters.query !== prevStoreQuery) {
    setPrevStoreQuery(filters.query);
    setLocalQuery(filters.query || "");
  }

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
    <div className="space-y-3">
      {/* Search bar + filter trigger */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1" role="search">
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
        <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" className="relative" aria-label="Open filters">
              <SlidersHorizontal className="h-4 w-4" />
              {hasActiveFilters && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand-green" />
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Filters</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              {/* Category */}
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  aria-label="Category"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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

              {/* Dynamic Category Attributes */}
              {selectedCategory && filterableAttributes.length > 0 && (
                <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-3 space-y-3 animate-in fade-in-0 slide-in-from-top-2 duration-300">
                  <p className="text-sm font-semibold text-brand-green flex items-center gap-1.5">
                    <selectedCategory.icon className="h-4 w-4" />
                    {selectedCategory.label} — Filters
                  </p>
                  {filterableAttributes.map((field) => (
                    <MobileFilterAttribute
                      key={field.name}
                      field={field}
                      value={filters.attributes[field.name]}
                      allAttributes={filters.attributes}
                      onChange={(val) => {
                        setAttribute(field.name, val);
                        if (field.name === "make") {
                          setAttribute("model", undefined);
                        }
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Location: Province → City */}
              <div className="space-y-2">
                <Label>Location</Label>
                <select
                  aria-label="Province"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={filters.province || ""}
                  onChange={(e) => {
                    setFilter("province", e.target.value || undefined);
                    // Clear city when province changes to avoid stale selection
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
                {filters.province && (
                  <select
                    aria-label="City"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-in fade-in-0 duration-200"
                    value={filters.city || ""}
                    onChange={(e) => setFilter("city", e.target.value || undefined)}
                  >
                    <option value="">All cities</option>
                    {getCitiesForProvince(filters.province).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <Label>Price range (ZAR)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="Min"
                    aria-label="Minimum price"
                    value={filters.priceMin || ""}
                    onChange={(e) =>
                      setFilter("priceMin", e.target.value ? Number(e.target.value) : undefined)
                    }
                  />
                  <span className="text-muted-foreground">—</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="Max"
                    aria-label="Maximum price"
                    value={filters.priceMax || ""}
                    onChange={(e) =>
                      setFilter("priceMax", e.target.value ? Number(e.target.value) : undefined)
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Condition</Label>
                <select
                  aria-label="Condition"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={filters.condition || ""}
                  onChange={(e) =>
                    setFilter(
                      "condition",
                      (e.target.value as typeof filters.condition) || undefined
                    )
                  }
                >
                  <option value="">Any condition</option>
                  {LISTING_CONDITIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    resetFilters();
                    setFilterOpen(false);
                  }}
                >
                  <X className="mr-1 h-3 w-3" />
                  Clear
                </Button>
                <Button
                  variant="trust-verified"
                  className="flex-1"
                  onClick={() => setFilterOpen(false)}
                >
                  Apply
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
