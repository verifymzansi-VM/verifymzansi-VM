"use client";

import { Building2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import { RemovableFilterChip, filterSelectClass } from "./filter-controls";

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
}

interface PromotionFilterPanelProps extends PromotionFilterCallbacks {
  filters: PromotionFilterState;
  activeTab: "tourism" | "events";
  cities: string[];
  businessMap: Map<string, string>;
  className?: string;
  mode?: "desktop" | "mobile";
}

const selectClassName = filterSelectClass;

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
  className,
  mode = "desktop",
}: PromotionFilterPanelProps) {
  const idPrefix = `promotion-filters-${mode}-${activeTab}`;
  const labelId = (name: string) => `${idPrefix}-${name}-label`;
  const hasActiveFilters = Boolean(
    filters.query ||
    filters.type ||
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
        mode === "desktop" ? "surface-card elev-xs rounded-2xl p-5" : "",
        "space-y-5",
        className
      )}
    >
      {mode === "desktop" ? (
        <h2 className="font-display text-base font-semibold tracking-tight">Filters</h2>
      ) : null}

      <div className="space-y-4">
        {activeTab === "tourism" ? (
          <div className="space-y-1.5">
            <Label id={labelId("subcategory")}>Subcategory</Label>
            <select
              aria-labelledby={labelId("subcategory")}
              aria-label="Tourism subcategory"
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
            <Label id={labelId("event-type")}>Event type</Label>
            <select
              aria-labelledby={labelId("event-type")}
              aria-label="Event type"
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
            <Label id={labelId("province")}>Province</Label>
            <select
              aria-labelledby={labelId("province")}
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
            <Label id={labelId("city")}>City</Label>
            <select
              aria-labelledby={labelId("city")}
              aria-label="City"
              className={selectClassName}
              value={filters.city || ""}
              onChange={(event) => onCityChange(event.target.value || undefined)}
              disabled={!filters.province}
            >
              <option value="">
                {filters.province ? "All cities" : "Choose a province first"}
              </option>
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
            <Label id={labelId("event-state")}>Event state</Label>
            <select
              aria-labelledby={labelId("event-state")}
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
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-4">
          {filters.query && (
            <RemovableFilterChip
              label={filters.query}
              removeLabel={`Remove query filter ${filters.query}`}
              onRemove={onClearQuery}
            />
          )}

          {filters.type && (
            <RemovableFilterChip
              label={getPromotionFilterTypeLabel(filters.type)}
              removeLabel="Remove promotion type filter"
              onRemove={() => onTypeChange(undefined)}
            />
          )}

          {filters.subcategory && (
            <RemovableFilterChip
              label={
                TOURISM_SUBCATEGORIES.find((s) => s.value === filters.subcategory)?.label ??
                filters.subcategory
              }
              removeLabel="Remove subcategory filter"
              onRemove={() => onSubcategoryChange(undefined)}
            />
          )}

          {filters.eventType && (
            <RemovableFilterChip
              label={
                EVENT_TYPES.find((et) => et.value === filters.eventType)?.label ?? filters.eventType
              }
              removeLabel="Remove event type filter"
              onRemove={() => onEventTypeChange(undefined)}
            />
          )}

          {filters.province && (
            <RemovableFilterChip
              label={filters.city ? `${filters.city}, ${filters.province}` : filters.province}
              removeLabel="Remove promotion location filter"
              onRemove={() => {
                onProvinceChange(undefined);
                onCityChange(undefined);
              }}
            />
          )}

          {filters.businessId && (
            <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 text-xs font-medium">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              {businessMap.get(filters.businessId) || "Linked business"}
            </span>
          )}

          {filters.eventState && (
            <RemovableFilterChip
              icon={<Calendar className="h-3.5 w-3.5" aria-hidden="true" />}
              label={PROMOTION_EVENT_STATE_LABELS[filters.eventState]}
              removeLabel="Remove event state filter"
              onRemove={() => onEventStateChange(undefined)}
            />
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={onClearAll}
          >
            Clear all
          </Button>
        </div>
      )}
    </section>
  );
}
