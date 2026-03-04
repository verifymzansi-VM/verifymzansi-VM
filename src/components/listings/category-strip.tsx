"use client";

import { useMarketplaceStore } from "@/stores";
import { CATEGORIES } from "@/lib/constants/categories";

export function CategoryStrip() {
  const { filters, setFilter } = useMarketplaceStore();

  return (
    <div className="max-w-xs">
      <select
        aria-label="Category"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        value={filters.category || ""}
        onChange={(e) => setFilter("category", e.target.value || undefined)}
      >
        <option value="">All Categories</option>
        {CATEGORIES.map((cat) => (
          <option key={cat.value} value={cat.value}>
            {cat.label}
          </option>
        ))}
      </select>
    </div>
  );
}
