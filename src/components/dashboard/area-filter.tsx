"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { AREA_LABELS, type MarketplaceArea } from "@/types/enums";

const FILTER_AREAS: MarketplaceArea[] = ["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"];

export function AreaFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("area") as MarketplaceArea | null;

  function setArea(area: MarketplaceArea | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (area) {
      params.set("area", area);
    } else {
      params.delete("area");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by area">
      <button
        type="button"
        onClick={() => setArea(null)}
        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          !current
            ? "bg-brand-green text-white"
            : "bg-warm-100 dark:bg-warm-800 text-muted-foreground hover:bg-warm-200 dark:hover:bg-warm-700"
        }`}
      >
        All
      </button>
      {FILTER_AREAS.map((area) => (
        <button
          key={area}
          type="button"
          onClick={() => setArea(area)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            current === area
              ? "bg-brand-green text-white"
              : "bg-warm-100 dark:bg-warm-800 text-muted-foreground hover:bg-warm-200 dark:hover:bg-warm-700"
          }`}
        >
          {AREA_LABELS[area]}
        </button>
      ))}
    </div>
  );
}
