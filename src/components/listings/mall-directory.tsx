"use client";

import { useMarketplaceStore } from "@/stores";
import { MALL_SHOP_CATEGORIES } from "@/lib/constants/categories";
import { cn } from "@/lib/utils";

export function MallDirectory() {
  const { filters, setFilter } = useMarketplaceStore();

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-display font-bold">Mall Directory</h2>
        {filters.category && (
          <button
            onClick={() => setFilter("category", undefined)}
            className="text-sm text-brand-gold hover:text-brand-gold-700 font-medium transition-colors"
          >
            View All Shops
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {MALL_SHOP_CATEGORIES.map((cat) => {
          const isSelected = filters.category === cat.value;
          const Icon = cat.icon;

          return (
            <button
              key={cat.value}
              onClick={() => setFilter("category", isSelected ? undefined : cat.value)}
              className={cn(
                "group relative flex flex-col items-center justify-center gap-3 p-6 text-center rounded-2xl border-2 transition-all duration-300",
                isSelected
                  ? "border-brand-gold bg-brand-gold text-amber-950 shadow-md shadow-brand-gold/20 scale-[1.02]"
                  : "border-border bg-card text-foreground hover:border-brand-gold/40 hover:bg-brand-gold/5 hover:-translate-y-1"
              )}
            >
              {/* Decorative background pulse for selected */}
              {isSelected && (
                <div className="absolute inset-0 bg-white/20 blur-xl rounded-2xl animate-pulse" />
              )}

              <div
                className={cn(
                  "w-12 h-12 flex items-center justify-center rounded-xl transition-colors shrink-0 relative z-10",
                  isSelected ? "bg-white/20" : "bg-brand-gold/10 group-hover:bg-brand-gold/20"
                )}
              >
                <Icon
                  className={cn(
                    "w-6 h-6",
                    isSelected ? "text-white" : "text-brand-gold group-hover:text-brand-gold-700"
                  )}
                />
              </div>
              <span className="font-semibold text-sm relative z-10">{cat.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
