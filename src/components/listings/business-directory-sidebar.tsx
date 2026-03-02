"use client";

import { useMarketplaceStore } from "@/stores";
import { BUSINESS_AD_CATEGORIES } from "@/lib/constants/categories";
import { cn } from "@/lib/utils";
import { Briefcase } from "lucide-react";

export function BusinessDirectorySidebar() {
  const { filters, setFilter } = useMarketplaceStore();

  return (
    <div className="bg-white dark:bg-zinc-950 border rounded-xl overflow-hidden shadow-sm sticky top-24">
      {/* Header */}
      <div className="p-4 border-b bg-brand-blue/5">
        <h2 className="font-display font-semibold flex items-center gap-2 text-brand-blue-900 dark:text-brand-blue-100">
          <Briefcase className="w-5 h-5 text-brand-blue-600" />
          Service Categories
        </h2>
      </div>

      {/* Categories List */}
      <div className="flex flex-col py-2">
        <button
          onClick={() => setFilter("category", undefined)}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors text-left",
            !filters.category
              ? "bg-brand-blue text-white shadow-inner"
              : "text-muted-foreground hover:bg-brand-blue/5 hover:text-brand-blue-700"
          )}
        >
          <div
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
              !filters.category ? "bg-white/20" : "bg-brand-blue/10 text-brand-blue-600"
            )}
          >
            <Briefcase className="w-3.5 h-3.5" />
          </div>
          All Services
        </button>

        {BUSINESS_AD_CATEGORIES.map((cat) => {
          const isSelected = filters.category === cat.value;
          const Icon = cat.icon;

          return (
            <button
              key={cat.value}
              onClick={() => setFilter("category", isSelected ? undefined : cat.value)}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors text-left",
                isSelected
                  ? "bg-brand-blue text-white shadow-inner"
                  : "text-foreground hover:bg-brand-blue/5 hover:text-brand-blue-700"
              )}
            >
              <div
                className={cn(
                  "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
                  isSelected ? "bg-white/20" : "bg-brand-blue/10 text-brand-blue-600"
                )}
              >
                <Icon className="w-3.5 h-3.5" />
              </div>
              {cat.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
