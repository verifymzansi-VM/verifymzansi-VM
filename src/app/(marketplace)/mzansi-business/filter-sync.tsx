"use client";

import { useCallback } from "react";
import { useMarketplaceUrlFilterSync } from "@/app/(marketplace)/_lib/use-marketplace-url-filter-sync";
import {
  parseBusinessFiltersFromSearchParams,
  serializeBusinessFiltersToSearchParams,
} from "@/lib/utils/marketplace-query";
import type { MarketplaceFilters } from "@/stores";

type BusinessParsedFilters = ReturnType<typeof parseBusinessFiltersFromSearchParams>;

export function MzansiBusinessFilterSync() {
  const getHydrationFilters = useCallback(
    (parsed: BusinessParsedFilters): Partial<MarketplaceFilters> => ({
      query: parsed.query,
      businessCategory: parsed.businessCategory,
      businessSubcategory: parsed.businessSubcategory,
      businessType: parsed.businessType,
      province: parsed.province,
      city: parsed.city,
    }),
    []
  );

  const serializeFilters = useCallback(
    (filters: MarketplaceFilters, page: number) =>
      serializeBusinessFiltersToSearchParams(
        {
          query: filters.query,
          businessCategory: filters.businessCategory,
          businessSubcategory: filters.businessSubcategory,
          businessType: filters.businessType,
          province: filters.province,
          city: filters.city,
        },
        page
      ),
    []
  );

  useMarketplaceUrlFilterSync({
    area: "MZANSI_BUSINESS",
    parseSearchParams: parseBusinessFiltersFromSearchParams,
    getHydrationFilters,
    serializeFilters,
  });

  return null;
}
