"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import { useMarketplaceStore } from "@/stores";
import { BUSINESS_CATEGORIES, BUSINESS_TYPE_OPTIONS } from "@/lib/constants/categories";
import { getProvinceNames, getCitiesForProvince } from "@/lib/constants/sa-provinces";

interface MallOption {
  id: string;
  name: string;
}

interface BusinessDiscoveryBarProps {
  malls: MallOption[];
}

export function BusinessDiscoveryBar({ malls }: BusinessDiscoveryBarProps) {
  const { filters, setFilter, resetFilters } = useMarketplaceStore();
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

  const clearQueryFilter = () => {
    debouncedSetQuery.cancel();
    setLocalQuery("");
    setFilter("query", undefined);
  };

  const clearAllFilters = () => {
    debouncedSetQuery.cancel();
    setLocalQuery("");
    resetFilters();
  };

  const hasActiveFilters = [
    filters.query,
    filters.businessCategory,
    filters.businessType,
    filters.province,
    filters.city,
    filters.mall,
  ].filter(Boolean).length;

  return (
    <section className="space-y-4 rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_repeat(5,minmax(0,1fr))]">
        <div className="space-y-1.5">
          <Label htmlFor="business-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="business-search"
              type="search"
              placeholder="Search businesses, services, or brands"
              className="pl-9"
              value={localQuery}
              onChange={(event) => {
                setLocalQuery(event.target.value);
                debouncedSetQuery(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-category">Category</Label>
          <select
            id="business-category"
            aria-label="Category"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={filters.businessCategory || ""}
            onChange={(event) =>
              setFilter(
                "businessCategory",
                event.target.value
                  ? (event.target.value as typeof filters.businessCategory)
                  : undefined
              )
            }
          >
            <option value="">All categories</option>
            {BUSINESS_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-type">Type</Label>
          <select
            id="business-type"
            aria-label="Business type"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={filters.businessType || ""}
            onChange={(event) =>
              setFilter(
                "businessType",
                event.target.value ? (event.target.value as typeof filters.businessType) : undefined
              )
            }
          >
            <option value="">All types</option>
            {BUSINESS_TYPE_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-province">Province</Label>
          <select
            id="business-province"
            aria-label="Province"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={filters.province || ""}
            onChange={(event) => {
              setFilter("province", event.target.value || undefined);
              setFilter("city", undefined);
            }}
          >
            <option value="">All provinces</option>
            {getProvinceNames().map((province) => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-city">City</Label>
          <select
            id="business-city"
            aria-label="City"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={filters.city || ""}
            onChange={(event) => setFilter("city", event.target.value || undefined)}
            disabled={!filters.province}
          >
            <option value="">All cities</option>
            {filters.province &&
              getCitiesForProvince(filters.province).map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business-mall">Mall</Label>
          <select
            id="business-mall"
            aria-label="Mall"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={filters.mall || ""}
            onChange={(event) => setFilter("mall", event.target.value || undefined)}
          >
            <option value="">All malls</option>
            {malls.map((mall) => (
              <option key={mall.id} value={mall.id}>
                {mall.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasActiveFilters > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {filters.query && (
            <Badge variant="secondary" className="gap-1">
              {filters.query}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove query filter ${filters.query}`}
                onClick={clearQueryFilter}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.businessCategory && (
            <Badge variant="secondary" className="gap-1">
              {BUSINESS_CATEGORIES.find((item) => item.value === filters.businessCategory)?.label}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove business category filter"
                onClick={() => setFilter("businessCategory", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.businessType && (
            <Badge variant="secondary" className="gap-1">
              {BUSINESS_TYPE_OPTIONS.find((item) => item.value === filters.businessType)?.label}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove business type filter"
                onClick={() => setFilter("businessType", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.province && (
            <Badge variant="secondary" className="gap-1">
              {filters.province}
              {filters.city && `, ${filters.city}`}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove location filter"
                onClick={() => {
                  setFilter("province", undefined);
                  setFilter("city", undefined);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {filters.mall && (
            <Badge variant="secondary" className="gap-1">
              {malls.find((mall) => mall.id === filters.mall)?.name || "Mall"}
              <button
                type="button"
                className="rounded-full p-0.5 transition-colors hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Remove mall filter"
                onClick={() => setFilter("mall", undefined)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}

          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={clearAllFilters}>
            Clear all
          </Button>
        </div>
      )}
    </section>
  );
}
