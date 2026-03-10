"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { CATEGORIES, type AttributeField } from "@/lib/constants/categories";
import { getModelsForMake } from "@/lib/constants/sa-vehicles";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { useMarketplaceStore } from "@/stores";
import { cn } from "@/lib/utils";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";

/* ─── Helpers ──────────────────────────────────────────────── */

function numberRangeOptions(field: AttributeField): string[] | null {
  const bedroom = ["bedrooms", "bathrooms", "parking_spots"];
  if (bedroom.includes(field.name)) {
    return ["1", "2", "3", "4", "5+"];
  }
  return null;
}

function resolveOption(option: string | { value: string; label: string }) {
  return typeof option === "string" ? { value: option, label: option } : option;
}

/* ─── Main Component ───────────────────────────────────────── */

export function ListingFilterSidebar() {
  const { filters, setFilter, setAttribute, resetFilters } = useMarketplaceStore();

  // Debounced search: instant keystroke feedback, deferred store update
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

  const selectedCategory = CATEGORIES.find((c) => c.value === filters.category);

  const filterableAttributes =
    selectedCategory?.attributeFields.filter(
      (f) => f.type === "select" || f.type === "boolean" || f.type === "number" || f.type === "text"
    ) ?? [];

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
    <div className="sticky top-24 space-y-4 max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin pr-1">
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
      {selectedCategory && filterableAttributes.length > 0 && (
        <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-3 space-y-3 animate-in fade-in-0 slide-in-from-top-2 duration-300">
          <p className="text-xs font-semibold text-brand-green flex items-center gap-1.5">
            <selectedCategory.icon className="h-3.5 w-3.5" />
            {selectedCategory.label} Filters
          </p>
          {filterableAttributes.map((field) => (
            <FilterAttributeField
              key={field.name}
              field={field}
              value={filters.attributes[field.name]}
              allAttributes={filters.attributes}
              onChange={(val) => {
                setAttribute(field.name, val);
                // Clear dependent fields when parent changes
                if (field.name === "make") {
                  setAttribute("model", undefined);
                }
              }}
            />
          ))}
        </div>
      )}

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

/* ─── Dynamic Attribute Filter Renderer ──────────────────────── */

function FilterAttributeField({
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
    "w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

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
        <div className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
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
          <div className="space-y-1">
            <Label className="text-xs">
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
        <div className="space-y-1">
          <Label className="text-xs">
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={field.placeholder || `Any`}
            className="text-xs h-8"
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
            id={`filter-${field.name}`}
            type="checkbox"
            aria-label={field.label}
            className="h-3.5 w-3.5 rounded border-input text-brand-green focus:ring-brand-green"
            checked={(value as boolean) || false}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
          />
          <Label htmlFor={`filter-${field.name}`} className="cursor-pointer text-xs font-normal">
            {field.label}
          </Label>
        </div>
      );

    default:
      return null;
  }
}
