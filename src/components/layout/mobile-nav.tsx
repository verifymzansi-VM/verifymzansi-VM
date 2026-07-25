"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShieldCheck, PlusCircle, ShieldAlert, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { triggerHaptic } from "@/lib/utils/haptics";

interface TabDef {
  id: "home" | "verify" | "post" | "trust-safety" | "dashboard";
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
    id: "trust-safety",
    href: "/trust-safety",
    icon: ShieldAlert,
    label: "Safety",
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

  return (
    <nav
      aria-label="Main"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-warm-200 bg-white shadow-[0_-10px_30px_rgba(15,23,42,0.08)] dark:border-warm-800 dark:bg-warm-900 md:hidden safe-area-inset-bottom"
    >
      <div className="flex items-center justify-around h-16 px-2">
        {TABS.map((tab) => {
          const href = tab.href;
          const resolvedHref =
            tab.requiresAuth && !isAuthenticated
              ? `/login?returnUrl=${encodeURIComponent(href)}`
              : href;
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.id}
              href={resolvedHref}
              prefetch={false}
              onClick={() => triggerHaptic("light")}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[44px] py-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isActive ? "text-brand-green" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute top-0 h-[3px] w-9 rounded-full bg-brand-green"
                />
              ) : null}
              <span
                className={cn(
                  "relative flex items-center justify-center rounded-full px-3 py-0.5 transition-colors",
                  isActive && "bg-brand-green-50 dark:bg-brand-green-950"
                )}
              >
                <Icon className={cn("h-5 w-5", tab.id === "post" && "h-6 w-6")} />
              </span>
              <span className="max-w-16 text-center text-xs font-medium leading-tight">
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
