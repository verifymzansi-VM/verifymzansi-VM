"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  PromotionFilterPanel,
  type PromotionFilterState,
} from "@/components/listings/promotion-filter-panel";
import type { PromotionFilterType } from "@/lib/promotions/type-taxonomy";
import type { BusinessCategory, PromotionEventState } from "@/types/enums";
import { triggerHaptic } from "@/lib/utils/haptics";
import { useHydrated } from "@/hooks/use-hydrated";

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

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) triggerHaptic("medium");
        setOpen(next);
      }}
    >
      {/* ── Inline filter bar (mobile only) ─────────── */}
      <div className="lg:hidden">
        {isHydrated ? (
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Open promotion filters"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Filter promotions &amp; events</span>
              {activeFilterCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </SheetTrigger>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground shadow-sm"
            aria-label="Open promotion filters"
            disabled
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Filter promotions &amp; events</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Drawer Content ───────────────────────────── */}
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-4">
          <SheetTitle>Filter Promotions &amp; Events</SheetTitle>
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
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
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
