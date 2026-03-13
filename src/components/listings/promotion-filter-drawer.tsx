"use client";

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  PromotionFilterPanel,
  type PromotionFilterState,
} from "@/components/listings/promotion-filter-panel";
import type { BusinessCategory, PromotionEventState, PromotionType } from "@/types/enums";

interface PromotionFilterDrawerProps {
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
  onQueryChange,
  onTypeChange,
  onCategoryChange,
  onProvinceChange,
  onCityChange,
  onEventStateChange,
  onClearQuery,
  onClearAll,
}: PromotionFilterDrawerProps) {
  const [open, setOpen] = useState(false);
  const activeFilterCount = countActivePromotionFilters(filters);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* ── FAB Trigger ──────────────────────────────── */}
      <div className="fixed bottom-20 right-4 z-40 lg:hidden">
        <SheetTrigger asChild>
          <Button
            size="lg"
            className="rounded-full shadow-lg h-14 w-14 bg-red-500 hover:bg-red-500/90"
            aria-label="Open promotion filters"
          >
            <SlidersHorizontal className="h-5 w-5" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
      </div>

      {/* ── Drawer Content ───────────────────────────── */}
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="flex flex-row items-center justify-between pb-4">
          <SheetTitle>Filter Promotions</SheetTitle>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
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
          onQueryChange={onQueryChange}
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
          <Button className="w-full" onClick={() => setOpen(false)}>
            Show results
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
