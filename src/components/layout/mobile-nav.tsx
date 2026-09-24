"use client";

import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, PlusCircle, Search, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { triggerHaptic } from "@/lib/utils/haptics";

interface TabDef {
  id: "home" | "verify" | "post" | "search" | "dashboard";
  href: string;
  icon: typeof Home;
  label: string;
  dotSource?: "profile";
  requiresAuth?: boolean;
}

const TABS: TabDef[] = [
  { id: "home", href: "/", icon: Home, label: "Home" },
  { id: "verify", href: "/verification", icon: ShieldCheck, label: "Verify" },
  { id: "post", href: "/post/create", icon: PlusCircle, label: "Post", requiresAuth: true },
  {
    id: "search",
    href: "/search",
    icon: Search,
    label: "Search",
  },
  {
    id: "dashboard",
    href: "/dashboard",
    icon: User,
    label: "Dashboard",
    dotSource: "profile",
    requiresAuth: true,
  },
];

export function MobileNav() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  if (pathname !== "/") return null;

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-0 right-0 z-50 px-3 pb-[max(env(safe-area-inset-bottom),10px)] md:hidden"
    >
      <div className="glass-panel elev-lg mx-auto flex h-16 max-w-md items-center justify-around rounded-2xl px-2">
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
                "relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[44px] py-2 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isPostAction
                  ? "text-white"
                  : isActive
                    ? "text-brand-green"
                    : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isActive && !isPostAction ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-[3px] w-9 rounded-full bg-brand-green"
                />
              ) : null}
              <span
                className={cn(
                  "relative flex items-center justify-center rounded-full transition-all",
                  isPostAction
                    ? "-mt-6 h-12 w-12 bg-brand-green text-white shadow-lg shadow-brand-green/30 ring-4 ring-background"
                    : cn("px-3 py-0.5", isActive && "bg-brand-green-50 dark:bg-brand-green-950")
                )}
              >
                <Icon className={cn("h-5 w-5", isPostAction && "h-6 w-6")} />
              </span>
              <span
                className={cn(
                  "max-w-16 text-center text-xs font-medium leading-tight",
                  isPostAction && "font-semibold text-brand-green"
                )}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
