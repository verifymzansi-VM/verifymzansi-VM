"use client";

import { useMarketplaceStore } from "@/stores";
import { BUSINESS_CATEGORIES } from "@/lib/constants/categories";
import type { BusinessCategory } from "@/types/enums";
import { cn } from "@/lib/utils";

interface BusinessCategoryStripProps {
  /** Category counts from the API — categories with 0 or missing count are hidden */
  categoryCounts?: Record<string, number>;
}

export function BusinessCategoryStrip({ categoryCounts }: BusinessCategoryStripProps) {
  const { filters, setFilter } = useMarketplaceStore();

  // Auto-hide empty categories when counts are available
  const visibleCategories = categoryCounts
    ? BUSINESS_CATEGORIES.filter((cat) => (categoryCounts[cat.value] ?? 0) > 0)
    : BUSINESS_CATEGORIES;

  if (visibleCategories.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Filter by category"
      className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide snap-x -mx-1 px-1"
    >
      {visibleCategories.map((cat) => {
        const Icon = cat.icon;
        const isSelected = filters.businessCategory === cat.value;
        const count = categoryCounts?.[cat.value];
        return (
          <button
            key={cat.value}
            type="button"
            aria-pressed={isSelected}
            onClick={() =>
              setFilter(
                "businessCategory" as keyof typeof filters,
                isSelected ? undefined : (cat.value as BusinessCategory)
              )
            }
            className={cn(
              "snap-start flex items-center gap-1.5 rounded-full border px-3 py-1.5 whitespace-nowrap text-xs font-medium transition-all duration-200 shrink-0",
              "hover:border-brand-blue/60 hover:bg-brand-blue/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-1",
              isSelected
                ? "border-brand-blue bg-brand-blue text-white shadow-sm"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{cat.label}</span>
            {count != null && (
              <span
                className={cn(
                  "ml-0.5 text-[10px]",
                  isSelected ? "text-blue-100" : "text-muted-foreground/60"
                )}
              >
                ({count})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
