"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, CalendarDays, Megaphone, ShoppingBag, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type MarketplaceSectionItem = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
  activeClass: string;
  inactiveClass: string;
  matches: (pathname: string) => boolean;
};

const MARKETPLACE_SECTION_ITEMS: MarketplaceSectionItem[] = [
  {
    href: "/mzansi-market",
    label: "Mzansi Market",
    description: "Buy and sell verified listings across South Africa.",
    icon: ShoppingBag,
    accentClass: "text-brand-green",
    activeClass: "border-brand-green/40 bg-brand-green/10 text-brand-green",
    inactiveClass: "border-border/70 hover:border-brand-green/30 hover:bg-brand-green/5",
    matches: (pathname) => pathname.startsWith("/mzansi-market"),
  },
  {
    href: "/mzansi-business",
    label: "Mzansi Business",
    description: "Find trusted businesses, shops, and service providers.",
    icon: Building2,
    accentClass: "text-brand-blue",
    activeClass: "border-brand-blue/40 bg-brand-blue/10 text-brand-blue",
    inactiveClass: "border-border/70 hover:border-brand-blue/30 hover:bg-brand-blue/5",
    matches: (pathname) => pathname.startsWith("/mzansi-business"),
  },
  {
    href: "/promotions",
    label: "Promotions",
    description: "Explore current offers, launches, and time-sensitive deals.",
    icon: Megaphone,
    accentClass: "text-red-500",
    activeClass: "border-red-400/40 bg-red-500/10 text-red-600 dark:text-red-300",
    inactiveClass: "border-border/70 hover:border-red-400/30 hover:bg-red-500/5",
    matches: (pathname) =>
      pathname.startsWith("/promotions") && !pathname.startsWith("/promotions/events"),
  },
  {
    href: "/promotions/events",
    label: "Events",
    description: "Jump straight to upcoming events and community happenings.",
    icon: CalendarDays,
    accentClass: "text-purple-500",
    activeClass: "border-purple-400/40 bg-purple-500/10 text-purple-600 dark:text-purple-300",
    inactiveClass: "border-border/70 hover:border-purple-400/30 hover:bg-purple-500/5",
    matches: (pathname) => pathname.startsWith("/promotions/events"),
  },
];

interface MarketplaceSectionNavProps {
  className?: string;
  heading?: string;
  description?: string;
  variant?: "desktop" | "mobile";
}

export function MarketplaceSectionNav({
  className,
  heading = "Browse sections",
  description = "Switch between market, business, promotions, and events without carrying old filters across.",
  variant = "desktop",
}: MarketplaceSectionNavProps) {
  const pathname = usePathname();
  const isMobile = variant === "mobile";

  return (
    <section
      aria-label="Marketplace sections"
      data-testid="marketplace-section-nav"
      className={cn(
        "rounded-2xl border border-border/70 bg-background/95 shadow-sm",
        isMobile ? "p-4" : "p-4",
        className
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-tight">{heading}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>

      <div className="mt-4 space-y-2">
        {MARKETPLACE_SECTION_ITEMS.map((item) => {
          const isActive = item.matches(pathname);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
                isActive ? item.activeClass : cn("text-foreground", item.inactiveClass)
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/80 shadow-sm",
                  item.accentClass,
                  !isActive && "text-current"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>

              <span className="min-w-0">
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  {item.description}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
