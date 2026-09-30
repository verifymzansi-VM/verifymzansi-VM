"use client";

import { BrandShield } from "@/components/shared/brand-shield";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingBag,
  MessageSquare,
  LogOut,
  Landmark,
  Handshake,
  BarChart3,
  Bell,
  CreditCard,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface DashboardNavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  /** Extra path prefixes that should mark this item as the current page. */
  alsoActiveFor?: string[];
}

export const DASHBOARD_MANAGE_NAV: DashboardNavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  {
    href: "/dashboard/listings",
    icon: ShoppingBag,
    label: "My posts",
    alsoActiveFor: ["/dashboard/businesses", "/dashboard/tourism-events"],
  },
  { href: "/dashboard/leads", icon: MessageSquare, label: "Leads" },
  { href: "/dashboard/metrics", icon: BarChart3, label: "Performance" },
];

export const DASHBOARD_ACCOUNT_NAV: DashboardNavItem[] = [
  {
    href: "/dashboard/profile",
    icon: UserRound,
    label: "Profile and settings",
    alsoActiveFor: ["/dashboard/settings", "/dashboard/complete-profile"],
  },
  { href: "/dashboard/communication", icon: Bell, label: "Notifications" },
  { href: "/billing", icon: CreditCard, label: "Plans and billing" },
  {
    href: "/dashboard/affiliations",
    icon: Landmark,
    label: "Affiliations",
    alsoActiveFor: ["/dashboard/organisation"],
  },
  { href: "/dashboard/partner", icon: Handshake, label: "Partner programme" },
];

export interface DashboardSidebarBadges {
  unreadLeads?: number;
  unreadNotifications?: number;
  rejectedListings?: number;
  pendingModeration?: number;
  incompleteVerification?: boolean;
  pendingReview?: boolean;
  verificationProgress?: { approved: number; submitted: number; total: number };
}

export function isDashboardNavItemActive(item: DashboardNavItem, pathname: string | null) {
  const path = pathname ?? "";
  if (item.href === "/dashboard") return path === "/dashboard";
  return [item.href, ...(item.alsoActiveFor ?? [])].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

export interface DashboardNavBadge {
  count: number;
  tone: "alert" | "pending";
  label: string;
}

export function getDashboardNavBadge(
  href: string,
  badges: DashboardSidebarBadges
): DashboardNavBadge | null {
  if (href === "/dashboard/leads" && (badges.unreadLeads ?? 0) > 0) {
    const count = badges.unreadLeads!;
    return { count, tone: "alert", label: `${count} new lead${count === 1 ? "" : "s"}` };
  }
  if (href === "/dashboard/listings") {
    const rejected = badges.rejectedListings ?? 0;
    if (rejected > 0) {
      return {
        count: rejected,
        tone: "alert",
        label: `${rejected} post${rejected === 1 ? "" : "s"} need${rejected === 1 ? "s" : ""} fixing`,
      };
    }
    const pending = badges.pendingModeration ?? 0;
    if (pending > 0) {
      return { count: pending, tone: "pending", label: `${pending} under review` };
    }
  }
  if (href === "/dashboard/communication" && (badges.unreadNotifications ?? 0) > 0) {
    const count = badges.unreadNotifications!;
    return { count, tone: "alert", label: `${count} unread` };
  }
  return null;
}

export function DashboardNavCount({ badge }: { badge: DashboardNavBadge }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums",
        badge.tone === "alert"
          ? "bg-brand-red-600 text-white"
          : "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/20 dark:text-brand-gold-200"
      )}
    >
      <span aria-hidden="true">{badge.count > 99 ? "99+" : badge.count}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

interface DashboardSidebarProps {
  badges?: DashboardSidebarBadges;
  onSignOut: () => void;
}

export function DashboardSidebar({ badges = {}, onSignOut }: DashboardSidebarProps) {
  const pathname = usePathname();

  function renderNavItem(item: DashboardNavItem) {
    const isActive = isDashboardNavItemActive(item, pathname);
    const Icon = item.icon;
    const badge = getDashboardNavBadge(item.href, badges);

    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isActive
              ? "bg-card font-semibold text-foreground elev-xs ring-1 ring-border/70"
              : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
          )}
        >
          <Icon
            aria-hidden="true"
            className={cn(
              "h-[18px] w-[18px]",
              isActive
                ? "text-brand-green-700 dark:text-brand-green-300"
                : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          <span className="flex-1 truncate">{item.label}</span>
          {badge ? <DashboardNavCount badge={badge} /> : null}
        </Link>
      </li>
    );
  }

  const progress = badges.verificationProgress;
  const showVerification =
    Boolean(progress) && Boolean(badges.incompleteVerification || badges.pendingReview);
  const progressCount = progress ? Math.max(progress.approved, progress.submitted) : 0;
  const progressPct = progress ? Math.round((progressCount / progress.total) * 100) : 0;

  return (
    <aside className="hidden w-64 shrink-0 border-r border-border/60 bg-muted/40 md:block lg:w-72">
      <div className="sticky top-[7.25rem] flex max-h-[calc(100vh-7.25rem)] flex-col gap-5 overflow-y-auto px-4 py-6">
        <nav aria-label="Dashboard" className="space-y-5">
          <div>
            <p className="px-3 pb-1.5 text-xs font-semibold text-muted-foreground">Manage</p>
            <ul className="space-y-0.5">{DASHBOARD_MANAGE_NAV.map(renderNavItem)}</ul>
          </div>
          <div>
            <p className="px-3 pb-1.5 text-xs font-semibold text-muted-foreground">Account</p>
            <ul className="space-y-0.5">{DASHBOARD_ACCOUNT_NAV.map(renderNavItem)}</ul>
          </div>
        </nav>

        {showVerification && progress ? (
          <Link
            href="/verification"
            className="block rounded-2xl border border-brand-green/25 bg-card p-3.5 elev-xs transition-colors hover:border-brand-green/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <BrandShield
                aria-hidden="true"
                className="h-4 w-4 text-brand-green-700 dark:text-brand-green-300"
              />
              {badges.pendingReview ? "Verification in review" : "Finish verification"}
            </p>
            <div
              className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Verification steps done"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progressCount}
            >
              <div
                className="h-full rounded-full bg-brand-green-600 transition-[width] duration-300 dark:bg-brand-green-400"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {progressCount} of {progress.total} steps{" "}
              {progress.submitted > progress.approved ? "submitted" : "done"}
            </p>
          </Link>
        ) : null}

        <div className="border-t border-border/60 pt-3">
          <Button
            variant="ghost"
            className="h-11 w-full justify-start gap-3 px-3 font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={onSignOut}
          >
            <LogOut aria-hidden="true" className="h-[18px] w-[18px]" />
            Sign out
          </Button>
        </div>
      </div>
    </aside>
  );
}
