"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useMarketplaceStore } from "@/stores";
import { parseMarketplaceFiltersFromSearchParams } from "@/lib/utils/marketplace-query";

export function MarketplaceUrlFilterSync() {
  const searchParams = useSearchParams();
  const setFilter = useMarketplaceStore((state) => state.setFilter);
  const searchParamKey = searchParams.toString();

  useEffect(() => {
    const { category, query } = parseMarketplaceFiltersFromSearchParams(searchParams);
    setFilter("category", category);
    setFilter("query", query);
  }, [searchParamKey, searchParams, setFilter]);

  return null;
}
