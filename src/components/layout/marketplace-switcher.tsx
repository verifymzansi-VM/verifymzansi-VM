"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ShoppingBag, Building2, TreePalm } from "lucide-react";
import type { MarketplaceArea } from "@/types/enums";

interface AreaTab {
  area: MarketplaceArea | "PROMOTIONS";
  label: string;
  mobileLabel: string;
  slug: string;
  icon: React.ElementType;
  iconColor: string;
  activeClass: string;
  hoverClass: string;
}

const AREA_TABS: AreaTab[] = [
  {
    area: "MZANSI_MARKET",
    label: "Mzansi Market",
    mobileLabel: "Market",
    slug: "/mzansi-market",
    icon: ShoppingBag,
    iconColor: "text-brand-green-600 dark:text-brand-green-400",
    activeClass: "text-brand-green-700 after:bg-brand-green-600 dark:text-brand-green-300",
    hoverClass: "hover:text-foreground",
  },
  {
    area: "MZANSI_BUSINESS",
    label: "Mzansi Business",
    mobileLabel: "Business",
    slug: "/mzansi-business",
    icon: Building2,
    iconColor: "text-brand-blue-600 dark:text-brand-blue-400",
    activeClass: "text-brand-blue-700 after:bg-brand-blue-600 dark:text-brand-blue-300",
    hoverClass: "hover:text-foreground",
  },
  {
    area: "PROMOTIONS",
    label: "Tourism & Events",
    mobileLabel: "Tourism & Events",
    slug: "/tourism-events",
    icon: TreePalm,
    iconColor: "text-sunset-600 dark:text-sunset-400",
    activeClass: "text-sunset-700 after:bg-sunset-600 dark:text-sunset-300",
    hoverClass: "hover:text-foreground",
  },
];

export function MarketplaceSwitcher() {
  const pathname = usePathname();

  return (
    <nav
      className="flex h-12 w-full items-stretch justify-between gap-1 overflow-x-auto scrollbar-hide sm:justify-start sm:gap-3 lg:w-fit lg:gap-2"
      aria-label="Marketplace areas"
    >
      {AREA_TABS.map((tab) => {
        const isActive =
          pathname.startsWith(tab.slug) ||
          (tab.area === "PROMOTIONS" && pathname.startsWith("/promotions"));
        const Icon = tab.icon;

        return (
          <Link
            key={tab.area}
            href={tab.slug}
            prefetch={false}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-1.5 text-[13px] font-semibold transition-colors after:absolute after:inset-x-1 after:bottom-0 after:h-[3px] after:rounded-t-full after:transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-2 sm:text-sm lg:px-3",
              isActive
                ? tab.activeClass
                : cn("text-muted-foreground after:bg-transparent", tab.hoverClass)
            )}
          >
            <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", tab.iconColor)} />
            <span className="lg:hidden">{tab.mobileLabel}</span>
            <span className="hidden lg:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
