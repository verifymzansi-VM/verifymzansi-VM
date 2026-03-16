"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ShoppingBag, Building2, Megaphone } from "lucide-react";
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
    label: "Promotions & Events",
    mobileLabel: "Promos",
    slug: "/promotions",
    icon: Megaphone,
    iconColor: "text-red-500",
    activeClass: "border-red-500 text-red-600 bg-red-50 dark:bg-red-950",
    hoverClass: "hover:border-red-400/40 hover:bg-red-50/80",
  },
];

export function MarketplaceSwitcher() {
  const pathname = usePathname();

  return (
    <nav
      className="mx-auto flex w-full items-center justify-center gap-1 overflow-x-auto pb-1 scrollbar-hide md:w-fit md:max-w-full md:overflow-visible md:pb-0"
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
              "inline-flex min-w-[6.5rem] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium leading-none transition-colors md:min-w-0 md:flex-none md:px-4 md:py-2 md:text-sm",
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
              className={cn("h-3.5 w-3.5 shrink-0 md:h-4 md:w-4", !isActive && tab.iconColor)}
            />
            <span className="truncate md:hidden">{tab.mobileLabel}</span>
            <span className="hidden md:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
