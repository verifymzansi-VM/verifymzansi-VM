"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  // Auto-hide empty categories when counts are available
  const visibleCategories = categoryCounts
    ? BUSINESS_CATEGORIES.filter((cat) => (categoryCounts[cat.value] ?? 0) > 0)
    : BUSINESS_CATEGORIES;

  if (visibleCategories.length === 0) return null;

  return (
    <div className="relative">
      {/* Left fade indicator */}
      <div
        className={cn(
          "pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-background to-transparent z-10 transition-opacity duration-200",
          canScrollLeft ? "opacity-100" : "opacity-0"
        )}
      />
      {/* Right fade indicator */}
      <div
        className={cn(
          "pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent z-10 transition-opacity duration-200",
          canScrollRight ? "opacity-100" : "opacity-0"
        )}
      />

      <div
        ref={scrollRef}
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
              aria-label={isSelected ? `${cat.label}, selected` : cat.label}
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
    </div>
  );
}
