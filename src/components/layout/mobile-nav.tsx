"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, PlusCircle, MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useLeadsUnread } from "@/hooks/use-leads-unread";
import { triggerHaptic } from "@/lib/utils/haptics";

interface TabDef {
  href: string;
  icon: typeof Home;
  label: string;
  dotSource?: "leads" | "profile";
  requiresAuth?: boolean;
}

const TABS: TabDef[] = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/mzansi-market", icon: Search, label: "Browse" },
  { href: "/post/create", icon: PlusCircle, label: "Post", requiresAuth: true },
  {
    href: "/dashboard/leads",
    icon: MessageSquare,
    label: "Leads",
    dotSource: "leads",
    requiresAuth: true,
  },
  {
    href: "/dashboard",
    icon: User,
    label: "Dashboard",
    dotSource: "profile",
    requiresAuth: true,
  },
];

/** Marketplace prefixes the Browse tab should match */
const BROWSE_PREFIXES = ["/mzansi-market", "/mzansi-business", "/promotions"];

export function MobileNav() {
  const pathname = usePathname();
  const { unreadCount: unreadLeads } = useLeadsUnread();
  const { isAuthenticated } = useAuth();

  // Resolve the Browse tab href to the user's current marketplace area
  const browseHref =
    BROWSE_PREFIXES.find((prefix) => pathname.startsWith(prefix)) || "/mzansi-market";

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-warm-200 bg-white shadow-[0_-10px_30px_rgba(15,23,42,0.08)] dark:border-warm-800 dark:bg-warm-900 md:hidden safe-area-inset-bottom"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {TABS.map((tab) => {
          const href = tab.label === "Browse" ? browseHref : tab.href;
          const resolvedHref =
            tab.requiresAuth && !isAuthenticated
              ? `/login?returnUrl=${encodeURIComponent(href)}`
              : href;
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const Icon = tab.icon;
          const showLeadBadge = tab.dotSource === "leads" && unreadLeads > 0;

          return (
            <Link
              key={tab.label}
              href={resolvedHref}
              prefetch={false}
              onClick={() => triggerHaptic("light")}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors",
                isActive ? "text-brand-green" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="relative">
                <Icon className={cn("h-5 w-5", tab.label === "Post" && "h-6 w-6")} />
                {showLeadBadge && (
                  <span className="absolute -top-2 -right-2 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground border border-background">
                    {unreadLeads > 99 ? "99+" : unreadLeads}
                  </span>
                )}
              </span>
              <span className="text-xs font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
