"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  PromotionFilterPanel,
  type PromotionFilterState,
} from "@/components/listings/promotion-filter-panel";
import {
  getPromotionFilterTypeLabel,
  type PromotionFilterType,
} from "@/lib/promotions/type-taxonomy";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import {
  PROMOTION_EVENT_STATE_LABELS,
  type BusinessCategory,
  type PromotionEventState,
} from "@/types/enums";
import { triggerHaptic } from "@/lib/utils/haptics";
import { useHydrated } from "@/hooks/use-hydrated";
import { ActiveFilterChips, type FilterChip } from "./active-filter-chips";

interface PromotionFilterDrawerProps {
  filters: PromotionFilterState;
  cities: string[];
  businessMap: Map<string, string>;
  onTypeChange: (value: PromotionFilterType | undefined) => void;
  onCategoryChange: (value: BusinessCategory | undefined) => void;
  onProvinceChange: (value: string | undefined) => void;
  onCityChange: (value: string | undefined) => void;
  onEventStateChange: (value: PromotionEventState | undefined) => void;
  onClearQuery: () => void;
  onClearAll: () => void;
}

function countActivePromotionFilters(filters: PromotionFilterState): number {
  let count = 0;
  if (filters.query) count++;
  if (filters.type) count++;
  if (filters.category) count++;
  if (filters.province) count++;
  if (filters.city) count++;
  if (filters.eventState) count++;
  return count;
}

export function PromotionFilterDrawer({
  filters,
  cities,
  businessMap,
  onTypeChange,
  onCategoryChange,
  onProvinceChange,
  onCityChange,
  onEventStateChange,
  onClearQuery,
  onClearAll,
}: PromotionFilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const isHydrated = useHydrated();
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
    const catLabel =
      BUSINESS_CATEGORIES.find((c) => c.value === filters.category)?.label ||
      String(filters.category).replace(/_/g, " ");
    activeChips.push({
      key: "category",
      label: catLabel,
      onRemove: () => onCategoryChange(undefined),
    });
  }
  if (filters.province) {
    const locLabel = filters.city ? `${filters.province} › ${filters.city}` : filters.province;
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

      {/* ── Sticky FAB filter button (mobile only) ── */}
      {isHydrated ? (
        <SheetTrigger asChild>
          <button
            type="button"
            className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-40 inline-flex h-9 w-9 items-center justify-center gap-1 rounded-full bg-amber-400 text-foreground shadow-lg transition-colors hover:bg-amber-500 active:bg-amber-600 md:hidden"
            aria-label="Open promotion filters"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[9px] font-bold text-amber-400">
                {activeFilterCount}
              </span>
            )}
          </button>
        </SheetTrigger>
      ) : (
        <button
          type="button"
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-4 z-40 inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 text-foreground shadow-lg opacity-50 md:hidden"
          aria-label="Open promotion filters"
          disabled
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
        </button>
      )}

      {/* ── Drawer Content ───────────────────────────── */}
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-2xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-3">
          <SheetTitle>Filter Tourism &amp; Events</SheetTitle>
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
          cities={cities}
          businessMap={businessMap}
          onTypeChange={onTypeChange}
          onCategoryChange={onCategoryChange}
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
