"use client";

import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { CATEGORIES } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { useMarketplaceStore } from "@/stores";
import { cn } from "@/lib/utils";

/* ─── Helpers ──────────────────────────────────────────────── */

function countActiveFilters(filters: {
  query?: string;
  category?: string;
  province?: string;
  city?: string;
  priceMin?: number;
  priceMax?: number;
  condition?: string;
}): number {
  let count = 0;
  if (filters.query) count++;
  if (filters.category) count++;
  if (filters.province) count++;
  if (filters.city) count++;
  if (filters.priceMin) count++;
  if (filters.priceMax) count++;
  if (filters.condition) count++;
  return count;
}

/* ─── Main Component ───────────────────────────────────────── */

export function ListingFilterDrawer() {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
  const [open, setOpen] = useState(false);

  // Debounced search: instant keystroke feedback, deferred store update
  const [localQuery, setLocalQuery] = useState(filters.query || "");
  const debouncedSetQuery = useDebouncedCallback(
    (value: string) => setFilter("query", value || undefined),
    300
  );
  const [prevStoreQuery, setPrevStoreQuery] = useState(filters.query);
  if (filters.query !== prevStoreQuery) {
    debouncedSetQuery.cancel();
    setPrevStoreQuery(filters.query);
    setLocalQuery(filters.query || "");
  }

  const activeFilterCount = countActiveFilters(filters);

  const selectClass =
    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* ── Inline filter bar (mobile only) ─────────── */}
      <div className="lg:hidden">
        <SheetTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Open listing filters"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Filter &amp; search listings</span>
            {activeFilterCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </SheetTrigger>
      </div>

      {/* ── Drawer Content ───────────────────────────── */}
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="flex flex-row items-center justify-between pb-4">
          <SheetTitle>Filters</SheetTitle>
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                debouncedSetQuery.cancel();
                setLocalQuery("");
                resetFilters();
              }}
            >
              <X className="mr-1 h-3 w-3" />
              Clear all
            </Button>
          )}
        </SheetHeader>

        <div className="space-y-5 pb-20">
          {/* ── Search ────────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Search</Label>
            <div className="relative" role="search">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search listings..."
                aria-label="Search listings"
                enterKeyHint="search"
                className="pl-9"
                value={localQuery}
                onChange={(e) => {
                  setLocalQuery(e.target.value);
                  debouncedSetQuery(e.target.value);
                }}
              />
            </div>
          </div>

          {/* ── Category ──────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Category</Label>
            <select
              aria-label="Category"
              className={selectClass}
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

          {/* ── Location ──────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Location</Label>
            <select
              aria-label="Province"
              className={selectClass}
              value={filters.province || ""}
              onChange={(e) => {
                setFilter("province", e.target.value || undefined);
                setFilter("city", undefined);
              }}
            >
              <option value="">All provinces</option>
              {getProvinceNames().map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              aria-label="City"
              className={cn(selectClass, !filters.province && "opacity-50")}
              value={filters.city || ""}
              onChange={(e) => setFilter("city", e.target.value || undefined)}
              disabled={!filters.province}
            >
              <option value="">{filters.province ? "All cities" : "Select province first"}</option>
              {filters.province &&
                getCitiesForProvince(filters.province).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
            </select>
          </div>

          {/* ── Price range ────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Price range (ZAR)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Min"
                aria-label="Minimum price"
                className="text-sm"
                value={filters.priceMin || ""}
                onChange={(e) =>
                  setFilter("priceMin", e.target.value ? Number(e.target.value) : undefined)
                }
              />
              <span className="text-muted-foreground text-xs shrink-0">&ndash;</span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="Max"
                aria-label="Maximum price"
                className="text-sm"
                value={filters.priceMax || ""}
                onChange={(e) =>
                  setFilter("priceMax", e.target.value ? Number(e.target.value) : undefined)
                }
              />
            </div>
          </div>

          {/* ── Condition ──────────────────────────────── */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Condition</Label>
            <div className="flex flex-wrap gap-2">
              {LISTING_CONDITIONS.map((cond) => (
                <button
                  key={cond.value}
                  type="button"
                  onClick={() =>
                    setFilter(
                      "condition",
                      filters.condition === cond.value ? undefined : cond.value
                    )
                  }
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                    filters.condition === cond.value
                      ? "border-brand-green bg-brand-green/10 text-brand-green"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                  )}
                >
                  {cond.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Apply (Close) Button ─────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 border-t bg-background p-4">
          <SheetClose asChild>
            <Button className="w-full" size="lg">
              Show results
            </Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}
