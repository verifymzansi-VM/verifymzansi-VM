"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ShoppingBag, MessageSquare, Settings, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

const PRIMARY_NAV: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/listings", icon: ShoppingBag, label: "My Posts" },
  { href: "/dashboard/leads", icon: MessageSquare, label: "Leads" },
];

const TERTIARY_NAV: NavItem[] = [{ href: "/dashboard/profile", icon: Settings, label: "Settings" }];

export interface DashboardSidebarBadges {
  unreadLeads?: number;
  unreadNotifications?: number;
  rejectedListings?: number;
  pendingModeration?: number;
  incompleteVerification?: boolean;
  pendingReview?: boolean;
  verificationProgress?: { approved: number; submitted: number; total: number };
}

interface DashboardSidebarProps {
  badges?: DashboardSidebarBadges;
  onSignOut: () => void;
}

export function DashboardSidebar({ badges = {}, onSignOut }: DashboardSidebarProps) {
  const pathname = usePathname();

  function getBadge(href: string): { count: number; variant: "destructive" | "pending" } | null {
    if (href === "/dashboard/leads" && (badges.unreadLeads ?? 0) > 0) {
      return { count: badges.unreadLeads!, variant: "destructive" };
    }
    if (href === "/dashboard/listings") {
      const total = (badges.rejectedListings ?? 0) + (badges.pendingModeration ?? 0);
      if (total > 0) return { count: total, variant: "destructive" };
    }
    return null;
  }

  function renderNavItem(item: NavItem) {
    const isActive =
      item.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(item.href);
    const Icon = item.icon;
    const badge = getBadge(item.href);

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-brand-green-50 text-brand-green dark:bg-brand-green-950"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{item.label}</span>
        {badge && (
          <Badge variant={badge.variant} className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold">
            {badge.count > 99 ? "99+" : badge.count}
          </Badge>
        )}
      </Link>
    );
  }

  return (
    <aside className="hidden md:flex md:w-56 lg:w-60 flex-col border-r bg-background py-4 px-3">
      <nav aria-label="Dashboard" className="flex-1 space-y-1">
        {/* Primary */}
        {PRIMARY_NAV.map(renderNavItem)}

        <Separator className="my-2" />

        {/* Tertiary */}
        {TERTIARY_NAV.map(renderNavItem)}

        {/* Verification progress */}
        {badges.verificationProgress &&
          badges.verificationProgress.approved < badges.verificationProgress.total &&
          (() => {
            const pct = Math.round(
              (badges.verificationProgress!.approved / badges.verificationProgress!.total) * 100
            );
            // Map to nearest Tailwind width utility
            const widthClass =
              pct === 0 ? "w-0" : pct <= 25 ? "w-1/4" : pct <= 50 ? "w-1/2" : "w-3/4";
            return (
              <div className="mt-3 rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Verification: {badges.verificationProgress!.approved}/
                  {badges.verificationProgress!.total} steps
                </p>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn("h-full rounded-full bg-brand-green transition-all", widthClass)}
                  />
                </div>
                {badges.verificationProgress!.submitted > badges.verificationProgress!.approved && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {badges.verificationProgress!.submitted - badges.verificationProgress!.approved}{" "}
                    pending review
                  </p>
                )}
              </div>
            );
          })()}
      </nav>

      <Separator className="my-3" />
      <Button
        variant="ghost"
        size="sm"
        className="justify-start gap-3 text-muted-foreground hover:text-destructive"
        onClick={onSignOut}
      >
        <LogOut className="h-4 w-4" />
        Sign Out
      </Button>
    </aside>
  );
}
