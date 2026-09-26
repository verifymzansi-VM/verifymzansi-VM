"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_ACCOUNT_NAV,
  DASHBOARD_MANAGE_NAV,
  DashboardNavCount,
  getDashboardNavBadge,
  isDashboardNavItemActive,
  type DashboardSidebarBadges,
} from "@/components/dashboard/dashboard-sidebar";

/**
 * Phone-width dashboard navigation: every section in one horizontal strip,
 * so nothing sits behind a hidden menu. The current section is scrolled into view.
 */
export function DashboardMobileNav({ badges = {} }: { badges?: DashboardSidebarBadges }) {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const items = [...DASHBOARD_MANAGE_NAV, ...DASHBOARD_ACCOUNT_NAV];

  useEffect(() => {
    const el = activeRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav
      aria-label="Dashboard sections"
      className="border-b border-border/60 bg-background/95 md:hidden"
    >
      <ul className="flex gap-1.5 overflow-x-auto px-4 py-2 scrollbar-hide">
        {items.map((item) => {
          const isActive = isDashboardNavItemActive(item, pathname);
          const Icon = item.icon;
          const badge = getDashboardNavBadge(item.href, badges);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                ref={isActive ? activeRef : undefined}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-foreground text-background"
                    : "border border-border bg-card text-foreground/80 hover:bg-muted"
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4" />
                {item.label}
                {badge ? <DashboardNavCount badge={badge} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
