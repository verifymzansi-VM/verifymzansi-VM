"use client";

import { Building2, Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EVENT_TYPES, TOURISM_SUBCATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import {
  getPromotionFilterTypeLabel,
  type PromotionFilterType,
} from "@/lib/promotions/type-taxonomy";
import {
  PROMOTION_EVENT_STATE_LABELS,
  type BusinessCategory,
  type PromotionEventState,
} from "@/types/enums";
import { cn } from "@/lib/utils";

export interface PromotionFilterState {
  query?: string;
  type?: PromotionFilterType;
  category?: BusinessCategory;
  eventType?: string;
  subcategory?: string;
  province?: string;
  city?: string;
  businessId?: string;
  eventState?: PromotionEventState;
}

export interface PromotionFilterCallbacks {
  onTypeChange: (value: PromotionFilterType | undefined) => void;
  onCategoryChange: (value: BusinessCategory | undefined) => void;
  onEventTypeChange: (value: string | undefined) => void;
  onSubcategoryChange: (value: string | undefined) => void;
  onProvinceChange: (value: string | undefined) => void;
  onCityChange: (value: string | undefined) => void;
  onEventStateChange: (value: PromotionEventState | undefined) => void;
  onClearQuery: () => void;
  onClearAll: () => void;
  /** Clears the linked-business filter; the chip is removable only when provided. */
  onBusinessClear?: () => void;
}

interface PromotionFilterPanelProps extends PromotionFilterCallbacks {
  filters: PromotionFilterState;
  activeTab: "tourism" | "events";
  cities: string[];
  businessMap: Map<string, string>;
  className?: string;
  mode?: "desktop" | "mobile";
}

// 28px hit area inside the chip; the negative margins keep the chip's height unchanged.
const chipRemoveClassName =
  "-my-1 -mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const selectClassName =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

export function PromotionFilterPanel({
  filters,
  activeTab,
  cities,
  businessMap,
  onTypeChange,
  onCategoryChange: _onCategoryChange,
  onEventTypeChange,
  onSubcategoryChange,
  onProvinceChange,
  onCityChange,
  onEventStateChange,
  onClearQuery,
  onClearAll,
  onBusinessClear,
  className,
  mode = "desktop",
}: PromotionFilterPanelProps) {
  const idPrefix = `promotion-filters-${mode}-${activeTab}`;
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  // The Events tab always carries type=event, so that type is implied by the
  // tab rather than being a removable filter of its own.
  const showTypeChip = Boolean(filters.type) && activeTab !== "events";
  const hasActiveFilters = Boolean(
    filters.query ||
    showTypeChip ||
    filters.category ||
    filters.eventType ||
    filters.subcategory ||
    filters.province ||
    filters.city ||
    filters.businessId ||
    filters.eventState
  );

  return (
    <section
      aria-label="Filters"
      className={cn(
        "space-y-5 rounded-2xl border border-border/70 bg-background/95 p-4 shadow-sm",
        className
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-tight">Refine what you see</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Filter by category, location, and event timing.
        </p>
      </div>

      <div className="space-y-4">
        {activeTab === "tourism" ? (
          <div className="space-y-1.5">
            <Label htmlFor={fieldId("subcategory")}>Subcategory</Label>
            <select
              id={fieldId("subcategory")}
              className={selectClassName}
              value={filters.subcategory || ""}
              onChange={(event) => onSubcategoryChange(event.target.value || undefined)}
            >
              <option value="">All subcategories</option>
              {TOURISM_SUBCATEGORIES.map((sub) => (
                <option key={sub.value} value={sub.value}>
                  {sub.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={fieldId("event-type")}>Event type</Label>
            <select
              id={fieldId("event-type")}
              className={selectClassName}
              value={filters.eventType || ""}
              onChange={(event) => onEventTypeChange(event.target.value || undefined)}
            >
              <option value="">All event types</option>
              {EVENT_TYPES.map((et) => (
                <option key={et.value} value={et.value}>
                  {et.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={cn("gap-3", mode === "mobile" ? "grid grid-cols-2" : "space-y-4")}>
          <div className="space-y-1.5">
            <Label htmlFor={fieldId("province")}>Province</Label>
            <select
              id={fieldId("province")}
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
            <Label htmlFor={fieldId("city")}>City</Label>
            <select
              id={fieldId("city")}
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

        {activeTab === "events" && (
          <div className="space-y-1.5">
            <Label htmlFor={fieldId("event-state")}>Event state</Label>
            <select
              id={fieldId("event-state")}
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
                className={chipRemoveClassName}
                aria-label={`Remove query filter ${filters.query}`}
                onClick={onClearQuery}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {showTypeChip && filters.type && (
            <Badge variant="secondary" className="gap-1">
              {getPromotionFilterTypeLabel(filters.type)}
              <button
                type="button"
                className={chipRemoveClassName}
                aria-label="Remove promotion type filter"
                onClick={() => onTypeChange(undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.subcategory && (
            <Badge variant="secondary" className="gap-1">
              {TOURISM_SUBCATEGORIES.find((s) => s.value === filters.subcategory)?.label ??
                filters.subcategory}
              <button
                type="button"
                className={chipRemoveClassName}
                aria-label="Remove subcategory filter"
                onClick={() => onSubcategoryChange(undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          {filters.eventType && (
            <Badge variant="secondary" className="gap-1">
              {EVENT_TYPES.find((et) => et.value === filters.eventType)?.label ?? filters.eventType}
              <button
                type="button"
                className={chipRemoveClassName}
                aria-label="Remove event type filter"
                onClick={() => onEventTypeChange(undefined)}
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
                className={chipRemoveClassName}
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
              {onBusinessClear ? (
                <button
                  type="button"
                  className={chipRemoveClassName}
                  aria-label="Remove linked business filter"
                  onClick={onBusinessClear}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </Badge>
          )}

          {filters.eventState && (
            <Badge variant="secondary" className="gap-1">
              <Calendar className="h-3 w-3" />
              {PROMOTION_EVENT_STATE_LABELS[filters.eventState]}
              <button
                type="button"
                className={chipRemoveClassName}
                aria-label="Remove event state filter"
                onClick={() => onEventStateChange(undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={onClearAll}>
            Clear all
          </Button>
        </div>
      )}
    </section>
  );
}
