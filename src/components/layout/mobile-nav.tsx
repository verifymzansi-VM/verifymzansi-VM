"use client";

import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Home, Plus, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { triggerHaptic } from "@/lib/utils/haptics";

interface TabDef {
  id: "home" | "search" | "post" | "verify" | "dashboard";
  href: string;
  icon: typeof Home;
  label: string;
  requiresAuth?: boolean;
  /** Extra path prefixes that should light this tab up. */
  activePrefixes?: string[];
}

const TABS: TabDef[] = [
  { id: "home", href: "/", icon: Home, label: "Home" },
  {
    id: "search",
    href: "/search",
    icon: Compass,
    label: "Search",
  },
  { id: "post", href: "/post/create", icon: Plus, label: "Post", requiresAuth: true },
  { id: "verify", href: "/verification", icon: ShieldCheck, label: "Verify" },
  {
    id: "dashboard",
    href: "/dashboard",
    icon: UserRound,
    label: "Account",
    requiresAuth: true,
  },
];

/**
 * Discovery surfaces get the app-style tab bar. Detail pages, posting,
 * checkout, auth and dashboards keep the screen for their own sticky actions.
 */
const NAV_EXACT_PATHS = new Set([
  "/",
  "/search",
  "/mzansi-market",
  "/mzansi-business",
  "/tourism-events",
  "/promotions",
  "/promotions/events",
  "/pricing",
  "/advertise",
  "/trust-safety",
  "/verify-buyer",
  "/contact",
]);

export function shouldShowMobileNav(pathname: string | null): boolean {
  if (!pathname) return false;
  if (NAV_EXACT_PATHS.has(pathname)) return true;
  return pathname === "/safety" || pathname.startsWith("/safety/");
}

export function MobileNav() {
  const pathname = usePathname();

  if (!shouldShowMobileNav(pathname)) return null;

  return <MobileNavBar pathname={pathname} />;
}

function MobileNavBar({ pathname }: { pathname: string }) {
  const { isAuthenticated } = useAuth();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/70 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-stretch justify-around px-1">
        {TABS.map((tab) => {
          const href = tab.href;
          const resolvedHref =
            tab.requiresAuth && !isAuthenticated
              ? `/login?returnUrl=${encodeURIComponent(href)}`
              : href;
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const Icon = tab.icon;
          const isPostAction = tab.id === "post";

          return (
            <Link
              key={tab.id}
              href={resolvedHref}
              prefetch={false}
              onClick={() => triggerHaptic("light")}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isPostAction
                  ? "text-foreground"
                  : isActive
                    ? "text-brand-green-700 dark:text-brand-green-300"
                    : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isPostAction ? (
                <span
                  aria-hidden="true"
                  className="-mt-1 flex h-10 w-12 items-center justify-center rounded-2xl bg-brand-green-600 text-white shadow-md shadow-brand-green/30 transition-transform group-active:scale-95 dark:bg-brand-green-500 dark:text-brand-green-950"
                >
                  <Icon className="h-6 w-6" strokeWidth={2.5} />
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    isActive && "bg-brand-green/10 dark:bg-brand-green/15"
                  )}
                >
                  <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.4 : 2} />
                </span>
              )}
              <span className="leading-none">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
