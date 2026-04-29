"use client";

import { useCallback } from "react";
import { useMarketplaceUrlFilterSync } from "@/app/(marketplace)/_lib/use-marketplace-url-filter-sync";
import {
  parseMarketplaceFiltersFromSearchParams,
  serializeMarketplaceFiltersToSearchParams,
} from "@/lib/utils/marketplace-query";
import type { MarketplaceFilters } from "@/stores";

type MarketParsedFilters = ReturnType<typeof parseMarketplaceFiltersFromSearchParams>;

export function MarketplaceUrlFilterSync() {
  const getHydrationFilters = useCallback(
    (parsed: MarketParsedFilters): Partial<MarketplaceFilters> => ({
      category: parsed.category,
      query: parsed.query,
      province: parsed.province,
      city: parsed.city,
      condition: parsed.condition,
      sort: parsed.sort ?? "newest",
      priceMin: parsed.priceMin,
      priceMax: parsed.priceMax,
      attributes: parsed.attributes,
    }),
    []
  );

  const serializeFilters = useCallback(
    (filters: MarketplaceFilters, page: number) =>
      serializeMarketplaceFiltersToSearchParams(
        {
          category: filters.category,
          query: filters.query,
          province: filters.province,
          city: filters.city,
          condition: filters.condition,
          sort: filters.sort,
          priceMin: filters.priceMin,
          priceMax: filters.priceMax,
          attributes: filters.attributes,
        },
        page
      ),
    []
  );

  useMarketplaceUrlFilterSync({
    area: "MZANSI_MARKET",
    parseSearchParams: parseMarketplaceFiltersFromSearchParams,
    getHydrationFilters,
    serializeFilters,
  });

  return null;
}
