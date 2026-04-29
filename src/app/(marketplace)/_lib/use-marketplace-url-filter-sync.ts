"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMarketplaceStore, type MarketplaceFilters } from "@/stores";
import type { MarketplaceArea } from "@/types/enums";

type SearchParamsLike = Pick<URLSearchParams, "get" | "forEach">;

export function useMarketplaceUrlFilterSync<TParsed extends { page: number }>({
  area,
  parseSearchParams,
  getHydrationFilters,
  serializeFilters,
}: {
  area: MarketplaceArea;
  parseSearchParams: (searchParams: SearchParamsLike) => TParsed;
  getHydrationFilters: (parsed: TParsed) => Partial<MarketplaceFilters>;
  serializeFilters: (filters: MarketplaceFilters, page: number) => URLSearchParams;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const hydrateFilters = useMarketplaceStore((state) => state.hydrateFilters);
  const filters = useMarketplaceStore((state) => state.filters);
  const page = useMarketplaceStore((state) => state.page);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    const parsed = parseSearchParams(searchParams);

    hydrateFilters(area, getHydrationFilters(parsed), parsed.page);
    hasHydratedRef.current = true;
  }, [area, getHydrationFilters, hydrateFilters, parseSearchParams, searchParamKey, searchParams]);

  useEffect(() => {
    if (!hasHydratedRef.current) return;

    const nextParams = serializeFilters(filters, page);
    const nextKey = nextParams.toString();
    if (nextKey === searchParamKey) return;

    router.replace(nextKey ? `${pathname}?${nextKey}` : pathname, { scroll: false });
  }, [filters, page, pathname, router, searchParamKey, serializeFilters]);
}
