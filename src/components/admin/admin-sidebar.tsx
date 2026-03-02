"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Flag,
  ScrollText,
  FileText,
  ShieldCheck,
  Clock,
  ChevronLeft,
  ChevronRight,
  ToggleLeft,
  Eye,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AdminNavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}

interface AdminSidebarProps {
  pendingVerifications?: number;
  openReports?: number;
  pendingModeration?: number;
  userRole?: string;
  evidenceDeskEnabled?: boolean;
}

const NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/verification", label: "Verify Sellers", icon: ShieldCheck },
  { href: "/admin/verification/evidence", label: "Evidence Desk", icon: Eye },
  { href: "/admin/moderation", label: "Moderation Queue", icon: Clock },
  { href: "/admin/reports", label: "Reports", icon: Flag },
  { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText, adminOnly: true },
  { href: "/admin/dsar", label: "Data Requests", icon: FileText, adminOnly: true },
  { href: "/admin/feature-flags", label: "Feature Flags", icon: ToggleLeft, adminOnly: true },
];

export function AdminSidebar({
  pendingVerifications = 0,
  openReports = 0,
  pendingModeration = 0,
  userRole = "moderator",
  evidenceDeskEnabled = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const filteredItems = NAV_ITEMS.filter((item) => !item.adminOnly || userRole === "admin").filter(
    (item) => item.href !== "/admin/verification/evidence" || evidenceDeskEnabled
  );

  // Assign dynamic badges
  function getBadge(href: string): number | undefined {
    if (href === "/admin/verification" && pendingVerifications > 0) return pendingVerifications;
    if (href === "/admin/reports" && openReports > 0) return openReports;
    if (href === "/admin/moderation" && pendingModeration > 0) return pendingModeration;
    return undefined;
  }

  return (
    <aside
      className={cn(
        "sticky top-[65px] h-[calc(100vh-65px)] border-r bg-card transition-all duration-200 flex flex-col",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-2">
          {filteredItems.map((item) => {
            const isActive =
              pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            const badge = getBadge(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge !== undefined && (
                      <Badge
                        variant="destructive"
                        className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold"
                      >
                        {badge > 99 ? "99+" : badge}
                      </Badge>
                    )}
                  </>
                )}
                {collapsed && badge !== undefined && (
                  <span className="absolute right-1 top-0 h-2 w-2 rounded-full bg-destructive" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}
