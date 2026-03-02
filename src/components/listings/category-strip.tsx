"use client";

import { useMarketplaceStore } from "@/stores";
import { CATEGORIES } from "@/lib/constants/categories";
import { cn } from "@/lib/utils";

export function CategoryStrip() {
  const { filters, setFilter } = useMarketplaceStore();

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide snap-x -mx-1 px-1">
      {CATEGORIES.map((cat) => {
        const Icon = cat.icon;
        const isSelected = filters.category === cat.value;
        return (
          <button
            key={cat.value}
            type="button"
            onClick={() => setFilter("category", isSelected ? undefined : cat.value)}
            className={cn(
              "snap-start flex items-center gap-1.5 rounded-full border px-3 py-1.5 whitespace-nowrap text-xs font-medium transition-all duration-200 shrink-0",
              "hover:border-brand-green/60 hover:bg-brand-green/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              isSelected
                ? "border-brand-green bg-brand-green text-white shadow-sm"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{cat.label}</span>
          </button>
        );
      })}
    </div>
  );
}
