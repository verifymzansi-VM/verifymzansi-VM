"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FilterEdgeTab } from "./filter-edge-tab";
import { Button } from "@/components/ui/button";
import {
  type PromotionFilterCallbacks,
  PromotionFilterPanel,
  type PromotionFilterState,
} from "@/components/listings/promotion-filter-panel";
import { getPromotionFilterTypeLabel } from "@/lib/promotions/type-taxonomy";
import { EVENT_TYPES, TOURISM_SUBCATEGORIES } from "@/lib/constants/categories";
import { PROMOTION_EVENT_STATE_LABELS } from "@/types/enums";
import { triggerHaptic } from "@/lib/utils/haptics";
import { ActiveFilterChips, type FilterChip } from "./active-filter-chips";

interface PromotionFilterDrawerProps extends PromotionFilterCallbacks {
  filters: PromotionFilterState;
  activeTab: "tourism" | "events";
  cities: string[];
  businessMap: Map<string, string>;
}

function countActivePromotionFilters(filters: PromotionFilterState): number {
  let count = 0;
  if (filters.query) count++;
  if (filters.type) count++;
  if (filters.category) count++;
  if (filters.eventType) count++;
  if (filters.subcategory) count++;
  if (filters.province) count++;
  if (filters.city) count++;
  if (filters.eventState) count++;
  return count;
}

export function PromotionFilterDrawer({
  filters,
  activeTab,
  cities,
  businessMap,
  onTypeChange,
  onCategoryChange,
  onEventTypeChange,
  onSubcategoryChange,
  onProvinceChange,
  onCityChange,
  onEventStateChange,
  onClearQuery,
  onClearAll,
}: PromotionFilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const activeFilterCount = countActivePromotionFilters(filters);

  /* ── Build active-filter chips for the strip ───────── */
  const activeChips: FilterChip[] = [];
  if (filters.query) {
    activeChips.push({ key: "query", label: filters.query, onRemove: onClearQuery });
  }
  if (filters.type) {
    activeChips.push({
      key: "type",
      label: getPromotionFilterTypeLabel(filters.type),
      onRemove: () => onTypeChange(undefined),
    });
  }
  if (filters.category) {
    const catValue = filters.category as string;
    const catLabel =
      TOURISM_SUBCATEGORIES.find((c) => c.value === catValue)?.label ||
      EVENT_TYPES.find((c) => c.value === catValue)?.label ||
      String(filters.category).replace(/_/g, " ");
    activeChips.push({
      key: "category",
      label: catLabel,
      onRemove: () => onCategoryChange(undefined),
    });
  }
  if (filters.subcategory) {
    const subLabel =
      TOURISM_SUBCATEGORIES.find((s) => s.value === filters.subcategory)?.label ||
      String(filters.subcategory).replace(/_/g, " ");
    activeChips.push({
      key: "subcategory",
      label: subLabel,
      onRemove: () => onSubcategoryChange(undefined),
    });
  }
  if (filters.eventType) {
    const etLabel =
      EVENT_TYPES.find((et) => et.value === filters.eventType)?.label ||
      String(filters.eventType).replace(/_/g, " ");
    activeChips.push({
      key: "eventType",
      label: etLabel,
      onRemove: () => onEventTypeChange(undefined),
    });
  }
  if (filters.province) {
    const locLabel = filters.city ? `${filters.city}, ${filters.province}` : filters.province;
    activeChips.push({
      key: "location",
      label: locLabel,
      onRemove: () => {
        onProvinceChange(undefined);
        onCityChange(undefined);
      },
    });
  }
  if (filters.eventState) {
    activeChips.push({
      key: "eventState",
      label: PROMOTION_EVENT_STATE_LABELS[filters.eventState],
      onRemove: () => onEventStateChange(undefined),
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
        <ActiveFilterChips
          chips={activeChips}
          onClearAll={() => {
            triggerHaptic("light");
            onClearAll();
          }}
        />
      </div>

      {/* ── Filters on the right wall (phones and tablets) ── */}
      <FilterEdgeTab
        label="Open tourism and events filters"
        count={activeFilterCount}
        open={open}
        onOpen={() => {
          triggerHaptic("medium");
          setOpen(true);
        }}
      />

      {/* ── Drawer Content ───────────────────────────── */}
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-3">
          <SheetTitle>Filters</SheetTitle>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                triggerHaptic("light");
                onClearAll();
                setOpen(false);
              }}
            >
              <X className="mr-1 h-3 w-3" />
              Clear all
            </Button>
          )}
        </SheetHeader>

        <PromotionFilterPanel
          filters={filters}
          activeTab={activeTab}
          cities={cities}
          businessMap={businessMap}
          onTypeChange={onTypeChange}
          onCategoryChange={onCategoryChange}
          onEventTypeChange={onEventTypeChange}
          onSubcategoryChange={onSubcategoryChange}
          onProvinceChange={onProvinceChange}
          onCityChange={onCityChange}
          onEventStateChange={onEventStateChange}
          onClearQuery={onClearQuery}
          onClearAll={onClearAll}
          mode="mobile"
          className="border-0 p-0 shadow-none"
        />

        {/* ── Apply button ─────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <Button
            className="w-full"
            onClick={() => {
              triggerHaptic("success");
              setOpen(false);
            }}
          >
            Show results
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
