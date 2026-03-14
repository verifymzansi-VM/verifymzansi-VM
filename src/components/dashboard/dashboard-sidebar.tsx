"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  MessageSquare,
  ShieldCheck,
  CreditCard,
  Building2,
  Megaphone,
  User,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { href: "/dashboard/listings", icon: Package, label: "My Listings" },
  { href: "/dashboard/leads", icon: MessageSquare, label: "Leads" },
  { href: "/dashboard/businesses", icon: Building2, label: "My Businesses" },
  { href: "/dashboard/promotions", icon: Megaphone, label: "Promotions & Events" },
  { href: "/verification", icon: ShieldCheck, label: "Verification" },
  { href: "/billing", icon: CreditCard, label: "Billing" },
  { href: "/dashboard/profile", icon: User, label: "My Profile" },
];

export interface DashboardSidebarBadges {
  unreadLeads?: number;
  rejectedListings?: number;
  pendingModeration?: number;
  incompleteVerification?: boolean;
  pendingReview?: boolean;
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
    if (href === "/verification" && badges.incompleteVerification && !badges.pendingReview) {
      return { count: 1, variant: "destructive" };
    }
    return null;
  }

  return (
    <aside className="hidden md:flex md:w-60 lg:w-64 flex-col border-r bg-background py-4 px-3">
      <nav aria-label="Dashboard" className="space-y-1 flex-1">
        {NAV_ITEMS.map((item) => {
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
                <Badge
                  variant={badge.variant}
                  className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold"
                >
                  {badge.count > 99 ? "99+" : badge.count}
                </Badge>
              )}
            </Link>
          );
        })}
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
