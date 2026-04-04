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
    iconColor: "text-brand-green",
    activeClass: "border-brand-green text-brand-green bg-brand-green-50 dark:bg-brand-green-950",
    hoverClass: "hover:border-brand-green/40 hover:bg-brand-green-50/80",
  },
  {
    area: "MZANSI_BUSINESS",
    label: "Mzansi Business",
    mobileLabel: "Business",
    slug: "/mzansi-business",
    icon: Building2,
    iconColor: "text-brand-blue",
    activeClass: "border-brand-blue text-brand-blue bg-brand-blue-50 dark:bg-brand-blue-950",
    hoverClass: "hover:border-brand-blue/40 hover:bg-brand-blue-50/80",
  },
  {
    area: "PROMOTIONS",
    label: "Tourism & Events",
    mobileLabel: "Tourism",
    slug: "/promotions",
    icon: TreePalm,
    iconColor: "text-teal-500",
    activeClass: "border-teal-500 text-teal-600 bg-teal-50 dark:bg-teal-950",
    hoverClass: "hover:border-teal-400/40 hover:bg-teal-50/80",
  },
];

export function MarketplaceSwitcher() {
  const pathname = usePathname();

  return (
    <nav
      className="mx-auto flex w-full items-center justify-center gap-1 overflow-x-auto pb-1 scrollbar-hide lg:w-fit lg:max-w-full lg:overflow-visible lg:pb-0"
      aria-label="Marketplace areas"
    >
      {AREA_TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.slug);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.area}
            href={tab.slug}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex min-w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors lg:min-w-0 lg:flex-none lg:px-4 lg:py-2 lg:text-sm",
              isActive
                ? tab.activeClass
                : cn(
                    "border-transparent text-muted-foreground hover:text-foreground",
                    tab.hoverClass
                  )
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4", !isActive && tab.iconColor)}
            />
            <span className="truncate lg:hidden">{tab.mobileLabel}</span>
            <span className="hidden lg:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
