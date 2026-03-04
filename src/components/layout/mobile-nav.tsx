"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, PlusCircle, MessageSquare, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotificationStore } from "@/stores/notification-store";

const TABS = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/mzansi-market", icon: Search, label: "Browse" },
  { href: "/post/create", icon: PlusCircle, label: "Post" },
  { href: "/dashboard/leads", icon: MessageSquare, label: "Leads", showDot: true },
  { href: "/dashboard", icon: User, label: "Profile", showDot: true },
] as const;

export function MobileNav() {
  const pathname = usePathname();
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t bg-background safe-area-inset-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {TABS.map((tab) => {
          const isActive = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          const showRedDot = "showDot" in tab && tab.showDot && unreadCount > 0;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors",
                isActive ? "text-brand-green" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="relative">
                <Icon className={cn("h-5 w-5", tab.href === "/post/create" && "h-6 w-6")} />
                {showRedDot && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-destructive border-2 border-background" />
                )}
              </span>
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
