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
  ChevronLeft,
  ChevronRight,
  ToggleLeft,
  Eye,
  ShoppingBag,
  Building2,
  Megaphone,
  Clock,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AdminSidebarProps {
  pendingVerifications?: number;
  openReports?: number;
  pendingModeration?: number;
  userRole?: string;
  evidenceDeskEnabled?: boolean;
}

interface NavSection {
  label: string;
  items: {
    href: string;
    label: string;
    icon: React.ElementType;
    adminOnly?: boolean;
    badgeCount?: number;
  }[];
}

export function AdminSidebar({
  pendingVerifications = 0,
  openReports = 0,
  pendingModeration = 0,
  userRole = "moderator",
  evidenceDeskEnabled = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = userRole === "admin";

  const sections: NavSection[] = [
    {
      label: "Overview",
      items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
      label: "Verification",
      items: [
        {
          href: "/admin/verification",
          label: "Verify Accounts",
          icon: ShieldCheck,
          badgeCount: pendingVerifications > 0 ? pendingVerifications : undefined,
        },
        ...(evidenceDeskEnabled
          ? [{ href: "/admin/verification/evidence", label: "Evidence Desk", icon: Eye }]
          : []),
      ],
    },
    {
      label: "Marketplace Areas",
      items: [
        { href: "/admin/mzansi-market", label: "Mzansi Market", icon: ShoppingBag },
        { href: "/admin/businesses", label: "Mzansi Business", icon: Building2 },
        { href: "/admin/promotions-events", label: "Promotions & Events", icon: Megaphone },
      ],
    },
    {
      label: "Queues",
      items: [
        {
          href: "/admin/moderation",
          label: "Moderation",
          icon: Clock,
          badgeCount: pendingModeration > 0 ? pendingModeration : undefined,
        },
        {
          href: "/admin/reports",
          label: "Reports",
          icon: Flag,
          badgeCount: openReports > 0 ? openReports : undefined,
        },
      ],
    },
    ...(isAdmin
      ? [
          {
            label: "Admin Tools",
            items: [
              { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
              { href: "/admin/dsar", label: "Data Requests", icon: FileText },
              { href: "/admin/feature-flags", label: "Feature Flags", icon: ToggleLeft },
            ],
          },
        ]
      : []),
  ];

  return (
    <aside
      className={cn(
        "sticky top-[65px] h-[calc(100vh-65px)] border-r bg-card transition-all duration-200 flex flex-col",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className="flex-1 overflow-y-auto py-3">
        {sections.map((section, sIdx) => (
          <div key={section.label} className={cn(sIdx > 0 && "mt-3")}>
            {/* Section label */}
            {!collapsed && (
              <p className="px-4 mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {section.label}
              </p>
            )}
            {collapsed && sIdx > 0 && <div className="mx-3 mb-2 border-t" />}

            <nav aria-label="Admin" className="space-y-0.5 px-2">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/admin" && pathname.startsWith(item.href));
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
                        {item.badgeCount !== undefined && (
                          <Badge
                            variant="destructive"
                            className="h-5 min-w-[20px] px-1.5 text-[10px] font-bold"
                          >
                            {item.badgeCount > 99 ? "99+" : item.badgeCount}
                          </Badge>
                        )}
                      </>
                    )}
                    {collapsed && item.badgeCount !== undefined && (
                      <span className="absolute right-1 top-0 h-2 w-2 rounded-full bg-destructive" />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
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
