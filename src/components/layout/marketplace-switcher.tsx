"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ShoppingBag, Building2, Megaphone } from "lucide-react";
import type { MarketplaceArea } from "@/types/enums";

interface AreaTab {
  area: MarketplaceArea | "PROMOTIONS";
  label: string;
  slug: string;
  icon: React.ElementType;
  iconColor: string;
  activeClass: string;
}

const AREA_TABS: AreaTab[] = [
  {
    area: "MZANSI_MARKET",
    label: "Mzansi Market",
    slug: "/mzansi-market",
    icon: ShoppingBag,
    iconColor: "text-brand-green",
    activeClass: "border-brand-green text-brand-green bg-brand-green-50 dark:bg-brand-green-950",
  },
  {
    area: "MZANSI_BUSINESS",
    label: "Mzansi Business",
    slug: "/mzansi-business",
    icon: Building2,
    iconColor: "text-brand-blue",
    activeClass: "border-brand-blue text-brand-blue bg-brand-blue-50 dark:bg-brand-blue-950",
  },
  {
    area: "PROMOTIONS",
    label: "Promotions & Events",
    slug: "/promotions",
    icon: Megaphone,
    iconColor: "text-red-500",
    activeClass: "border-red-500 text-red-600 bg-red-50 dark:bg-red-950",
  },
];

export function MarketplaceSwitcher() {
  const pathname = usePathname();

  return (
    <nav
      className="flex items-center gap-1 w-full justify-around md:justify-start md:w-auto"
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
              "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 md:px-3 md:py-2 text-sm font-medium transition-colors",
              isActive
                ? tab.activeClass
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Icon className={cn("h-5 w-5 md:h-4 md:w-4 shrink-0", !isActive && tab.iconColor)} />
            <span className="hidden lg:inline">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
