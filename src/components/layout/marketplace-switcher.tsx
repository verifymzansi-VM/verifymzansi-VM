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
    activeClass: "bg-card text-brand-green shadow-sm ring-1 ring-brand-green/30",
    hoverClass: "hover:bg-card/70 hover:text-foreground",
  },
  {
    area: "MZANSI_BUSINESS",
    label: "Mzansi Business",
    mobileLabel: "Business",
    slug: "/mzansi-business",
    icon: Building2,
    iconColor: "text-brand-blue",
    activeClass:
      "bg-card text-brand-blue shadow-sm ring-1 ring-brand-blue/30 dark:text-brand-blue-300",
    hoverClass: "hover:bg-card/70 hover:text-foreground",
  },
  {
    area: "PROMOTIONS",
    label: "Tourism & Events",
    mobileLabel: "Tourism & Events",
    slug: "/tourism-events",
    icon: TreePalm,
    iconColor: "text-teal-500",
    activeClass: "bg-card text-teal-600 shadow-sm ring-1 ring-teal-500/30 dark:text-teal-300",
    hoverClass: "hover:bg-card/70 hover:text-foreground",
  },
];

export function MarketplaceSwitcher() {
  const pathname = usePathname();

  return (
    <nav
      className="mx-auto flex w-full items-center justify-center gap-0.5 overflow-x-auto rounded-full border border-border/60 bg-muted/70 p-1 scrollbar-hide lg:w-fit lg:max-w-full lg:overflow-visible lg:border-border/50 lg:bg-background/70 lg:shadow-xs lg:backdrop-blur-md"
      aria-label="Marketplace areas"
    >
      {AREA_TABS.map((tab) => {
        const isActive = pathname.startsWith(tab.slug);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.area}
            href={tab.slug}
            prefetch={false}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-semibold leading-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 lg:min-w-0 lg:flex-none lg:gap-1.5 lg:px-4 lg:py-2 lg:text-sm lg:leading-none",
              isActive
                ? tab.activeClass
                : cn("text-muted-foreground hover:text-foreground", tab.hoverClass)
            )}
          >
            <Icon
              aria-hidden="true"
              className={cn("h-3.5 w-3.5 shrink-0 lg:h-4 lg:w-4", !isActive && tab.iconColor)}
            />
            <span className="text-center lg:hidden">{tab.mobileLabel}</span>
            <span className="hidden lg:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
