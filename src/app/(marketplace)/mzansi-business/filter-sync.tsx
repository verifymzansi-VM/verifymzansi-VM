"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMarketplaceStore } from "@/stores";
import {
  parseBusinessFiltersFromSearchParams,
  serializeBusinessFiltersToSearchParams,
} from "@/lib/utils/marketplace-query";

export function MzansiBusinessFilterSync() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const hydrateFilters = useMarketplaceStore((state) => state.hydrateFilters);
  const filters = useMarketplaceStore((state) => state.filters);
  const page = useMarketplaceStore((state) => state.page);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    const parsed = parseBusinessFiltersFromSearchParams(searchParams);

    hydrateFilters(
      "MZANSI_BUSINESS",
      {
        query: parsed.query,
        businessCategory: parsed.businessCategory,
        businessType: parsed.businessType,
        province: parsed.province,
        city: parsed.city,
        mall: parsed.mall,
      },
      parsed.page
    );

    hasHydratedRef.current = true;
  }, [hydrateFilters, searchParamKey, searchParams]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;

    const nextParams = serializeBusinessFiltersToSearchParams(
      {
        query: filters.query,
        businessCategory: filters.businessCategory,
        businessType: filters.businessType,
        province: filters.province,
        city: filters.city,
        mall: filters.mall,
      },
      page
    );

    const nextKey = nextParams.toString();
    if (nextKey === searchParamKey) return;

    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
  }, [filters, page, pathname, router, searchParamKey]);

  return null;
}
