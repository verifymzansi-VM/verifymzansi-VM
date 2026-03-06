"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMarketplaceStore } from "@/stores";
import {
  parseMarketplaceFiltersFromSearchParams,
  serializeMarketplaceFiltersToSearchParams,
} from "@/lib/utils/marketplace-query";

export function MarketplaceUrlFilterSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const hydrateFilters = useMarketplaceStore((state) => state.hydrateFilters);
  const filters = useMarketplaceStore((state) => state.filters);
  const page = useMarketplaceStore((state) => state.page);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    const parsed = parseMarketplaceFiltersFromSearchParams(searchParams);

    hydrateFilters(
      "MZANSI_MARKET",
      {
        category: parsed.category,
        query: parsed.query,
        province: parsed.province,
        city: parsed.city,
        condition: parsed.condition,
        sort: parsed.sort ?? "newest",
        priceMin: parsed.priceMin,
        priceMax: parsed.priceMax,
        attributes: parsed.attributes,
      },
      parsed.page
    );

    hasHydratedRef.current = true;
  }, [hydrateFilters, searchParamKey, searchParams]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;

    const nextParams = serializeMarketplaceFiltersToSearchParams(
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
    );

    const nextKey = nextParams.toString();
    if (nextKey === searchParamKey) return;

    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
  }, [filters, page, pathname, router, searchParamKey]);

  return null;
}
