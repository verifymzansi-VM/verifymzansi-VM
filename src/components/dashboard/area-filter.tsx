"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { AREA_LABELS, type MarketplaceArea } from "@/types/enums";

const FILTER_AREAS: MarketplaceArea[] = ["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"];

const ACTIVE_CLASSES: Record<MarketplaceArea | "ALL", string> = {
  ALL: "border-foreground bg-foreground text-background",
  MZANSI_MARKET:
    "border-brand-green-600 bg-brand-green-600 text-white dark:border-brand-green-500 dark:bg-brand-green-500 dark:text-brand-green-950",
  MZANSI_BUSINESS:
    "border-brand-blue-600 bg-brand-blue-600 text-white dark:border-brand-blue-500 dark:bg-brand-blue-500",
  PROMOTIONS_EVENTS:
    "border-teal-700 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-teal-950",
};

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

  const options: Array<{
    key: MarketplaceArea | "ALL";
    label: string;
    value: MarketplaceArea | null;
  }> = [
    { key: "ALL", label: "All areas", value: null },
    ...FILTER_AREAS.map((area) => ({ key: area, label: AREA_LABELS[area], value: area })),
  ];

  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:flex-wrap sm:px-0"
      role="group"
      aria-label="Filter by area"
    >
      {options.map((option) => {
        const isActive = option.value === null ? !current : current === option.value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => setArea(option.value)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive
                ? ACTIVE_CLASSES[option.key]
                : "border-border bg-card text-foreground/80 hover:border-foreground/25 hover:bg-muted"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
