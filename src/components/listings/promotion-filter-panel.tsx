"use client";

import { Building2, Calendar, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import {
  PROMOTION_EVENT_STATE_LABELS,
  type BusinessCategory,
  type PromotionEventState,
  type PromotionType,
} from "@/types/enums";
import { cn } from "@/lib/utils";

const PROMOTION_TYPE_OPTIONS: Array<{ value: PromotionType; label: string }> = [
  { value: "deal", label: "Deal" },
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
  { value: "event", label: "Event" },
  { value: "general", label: "Ad" },
];

export interface PromotionFilterState {
  query?: string;
  type?: PromotionType;
  category?: BusinessCategory;
  province?: string;
  city?: string;
  businessId?: string;
  eventState?: PromotionEventState;
}

interface PromotionFilterPanelProps {
  filters: PromotionFilterState;
  cities: string[];
  businessMap: Map<string, string>;
  onQueryChange: (value: string) => void;
  onTypeChange: (value: PromotionType | undefined) => void;
  onCategoryChange: (value: BusinessCategory | undefined) => void;
  onProvinceChange: (value: string | undefined) => void;
  onCityChange: (value: string | undefined) => void;
  onEventStateChange: (value: PromotionEventState | undefined) => void;
  onClearQuery: () => void;
  onClearAll: () => void;
  className?: string;
  mode?: "desktop" | "mobile";
}

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function PromotionFilterPanel({
  filters,
  cities,
  businessMap,
  onQueryChange,
  onTypeChange,
  onCategoryChange,
  onProvinceChange,
  onCityChange,
  onEventStateChange,
  onClearQuery,
  onClearAll,
  className,
  mode = "desktop",
}: PromotionFilterPanelProps) {
  const hasActiveFilters = Boolean(
    filters.query ||
    filters.type ||
    filters.category ||
    filters.province ||
    filters.city ||
    filters.businessId ||
    filters.eventState
  );

  return (
    <section
      className={cn(
        "space-y-5 rounded-2xl border border-border/70 bg-background/95 p-4 shadow-sm",
        className
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-tight">Refine what you see</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Search first, then filter by promotion type, category, and location.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={mode === "mobile" ? "promotion-search-mobile" : "promotion-search"}>
            Search
          </Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              key={`${mode}-${filters.query ?? ""}`}
              id={mode === "mobile" ? "promotion-search-mobile" : "promotion-search"}
              type="search"
              placeholder="Search promotions, deals, or events"
              className="pl-9"
              defaultValue={filters.query ?? ""}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={mode === "mobile" ? "promotion-type-mobile" : "promotion-type"}>
            Promotion type
          </Label>
          <select
            id={mode === "mobile" ? "promotion-type-mobile" : "promotion-type"}
            aria-label="Promotion type"
            className={selectClassName}
            value={filters.type || ""}
            onChange={(event) =>
              onTypeChange((event.target.value || undefined) as PromotionType | undefined)
            }
          >
            <option value="">All types</option>
            {PROMOTION_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={mode === "mobile" ? "promotion-category-mobile" : "promotion-category"}>
            Category
          </Label>
          <select
            id={mode === "mobile" ? "promotion-category-mobile" : "promotion-category"}
            aria-label="Promotion category"
            className={selectClassName}
            value={filters.category || ""}
            onChange={(event) =>
              onCategoryChange((event.target.value || undefined) as BusinessCategory | undefined)
            }
          >
            <option value="">All categories</option>
            {BUSINESS_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>
        </div>

        <div className={cn("gap-3", mode === "mobile" ? "grid grid-cols-2" : "space-y-4")}>
          <div className="space-y-1.5">
            <Label htmlFor={mode === "mobile" ? "promotion-province-mobile" : "promotion-province"}>
              Province
            </Label>
            <select
              id={mode === "mobile" ? "promotion-province-mobile" : "promotion-province"}
              aria-label="Province"
              className={selectClassName}
              value={filters.province || ""}
              onChange={(event) => onProvinceChange(event.target.value || undefined)}
            >
              <option value="">All provinces</option>
              {getProvinceNames().map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={mode === "mobile" ? "promotion-city-mobile" : "promotion-city"}>
              City
            </Label>
            <select
              id={mode === "mobile" ? "promotion-city-mobile" : "promotion-city"}
              aria-label="City"
              className={selectClassName}
              value={filters.city || ""}
              onChange={(event) => onCityChange(event.target.value || undefined)}
              disabled={!filters.province}
            >
              <option value="">{filters.province ? "All cities" : "Select province first"}</option>
              {cities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filters.type === "event" && (
          <div className="space-y-1.5">
            <Label
              htmlFor={mode === "mobile" ? "promotion-event-state-mobile" : "promotion-event-state"}
            >
              Event state
            </Label>
            <select
              id={mode === "mobile" ? "promotion-event-state-mobile" : "promotion-event-state"}
              aria-label="Event state"
              className={selectClassName}
              value={filters.eventState || ""}
              onChange={(event) =>
                onEventStateChange(
                  (event.target.value || undefined) as PromotionEventState | undefined
                )
              }
            >
              <option value="">All event states</option>
              {Object.entries(PROMOTION_EVENT_STATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.query && (
            <Badge variant="secondary" className="gap-1">
              {filters.query}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove query filter ${filters.query}`}
                onClick={onClearQuery}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.type && (
            <Badge variant="secondary" className="gap-1">
              {PROMOTION_TYPE_OPTIONS.find((option) => option.value === filters.type)?.label}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove promotion type filter"
                onClick={() => onTypeChange(undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.category && (
            <Badge variant="secondary" className="gap-1">
              {BUSINESS_CATEGORIES.find((category) => category.value === filters.category)?.label}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove promotion category filter"
                onClick={() => onCategoryChange(undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.province && (
            <Badge variant="secondary" className="gap-1">
              {filters.province}
              {filters.city && `, ${filters.city}`}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove promotion location filter"
                onClick={() => {
                  onProvinceChange(undefined);
                  onCityChange(undefined);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.businessId && (
            <Badge variant="secondary" className="gap-1">
              <Building2 className="h-3 w-3" />
              {businessMap.get(filters.businessId) || "Linked business"}
            </Badge>
          )}

          {filters.eventState && (
            <Badge variant="secondary" className="gap-1">
              <Calendar className="h-3 w-3" />
              {PROMOTION_EVENT_STATE_LABELS[filters.eventState]}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove event state filter"
                onClick={() => onEventStateChange(undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearAll}>
            Clear all
          </Button>
        </div>
      )}
    </section>
  );
}
