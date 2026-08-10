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
  TreePalm,
  Clock,
  Gavel,
  BarChart3,
  AlertTriangle,
  Users,
  TrendingUp,
  Scale,
  Menu,
  Inbox,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

interface AdminSidebarProps {
  pendingVerifications?: number;
  openReports?: number;
  pendingModeration?: number;
  newSupportRequests?: number;
  userRole?: string;
  evidenceDeskEnabled?: boolean;
}

interface NavSection {
  label: string;
  items: {
    href: string;
    label: string;
    icon: React.ElementType;
    badgeCount?: number;
  }[];
}

function buildModeratorSections(
  pendingVerifications: number,
  openReports: number,
  pendingModeration: number,
  newSupportRequests: number,
  evidenceDeskEnabled: boolean
): NavSection[] {
  return [
    {
      label: "Operations",
      items: [{ href: "/admin", label: "My Queue", icon: LayoutDashboard }],
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
        { href: "/admin/tourism-events", label: "Tourism & Events", icon: TreePalm },
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
        {
          href: "/admin/support",
          label: "Support Inbox",
          icon: Inbox,
          badgeCount: newSupportRequests > 0 ? newSupportRequests : undefined,
        },
      ],
    },
  ];
}

function buildGovernanceSections(newSupportRequests: number): NavSection[] {
  return [
    {
      label: "Governance",
      items: [{ href: "/admin", label: "Approval Center", icon: Gavel }],
    },
    {
      label: "Decisions",
      items: [
        {
          href: "/admin/governance/escalations",
          label: "Escalations",
          icon: AlertTriangle,
        },
        {
          href: "/admin/governance/appeals",
          label: "Appeals",
          icon: Scale,
        },
        {
          href: "/admin/governance/enforcement",
          label: "Enforcement Review",
          icon: ShieldCheck,
        },
      ],
    },
    {
      label: "Oversight",
      items: [
        { href: "/admin/governance/oversight", label: "Oversight Hub", icon: Eye },
        { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
        { href: "/admin/governance/roles", label: "Role Management", icon: Users },
      ],
    },
    {
      label: "Compliance",
      items: [
        { href: "/admin/dsar", label: "Data Requests", icon: FileText },
        {
          href: "/admin/support",
          label: "Support Inbox",
          icon: Inbox,
          badgeCount: newSupportRequests > 0 ? newSupportRequests : undefined,
        },
      ],
    },
  ];
}

function buildAdminSections(
  pendingVerifications: number,
  openReports: number,
  pendingModeration: number,
  newSupportRequests: number,
  evidenceDeskEnabled: boolean
): NavSection[] {
  return [
    // Intelligence (admin-exclusive analytics)
    {
      label: "Intelligence",
      items: [{ href: "/admin", label: "Strategy Dashboard", icon: LayoutDashboard }],
    },
    {
      label: "Analytics",
      items: [
        { href: "/admin/intelligence/users", label: "Users & Growth", icon: Users },
        {
          href: "/admin/intelligence/verification",
          label: "Verification Metrics",
          icon: ShieldCheck,
        },
        { href: "/admin/intelligence/revenue", label: "Revenue & Costs", icon: TrendingUp },
        { href: "/admin/intelligence/marketplace", label: "Marketplace Health", icon: BarChart3 },
        { href: "/admin/intelligence/trends", label: "Trend Analysis", icon: TrendingUp },
        { href: "/admin/intelligence/operations", label: "Ops Summary", icon: Clock },
      ],
    },
    // Governance (decisions, oversight, appeals)
    {
      label: "Governance",
      items: [
        {
          href: "/admin/governance/escalations",
          label: "Escalations",
          icon: AlertTriangle,
        },
        { href: "/admin/governance/appeals", label: "Appeals", icon: Scale },
        {
          href: "/admin/governance/enforcement",
          label: "Enforcement Review",
          icon: ShieldCheck,
        },
        { href: "/admin/governance/oversight", label: "Oversight Hub", icon: Eye },
        { href: "/admin/governance/roles", label: "Role Management", icon: Users },
        { href: "/admin/audit-log", label: "Audit Log", icon: ScrollText },
        { href: "/admin/dsar", label: "Data Requests", icon: FileText },
      ],
    },
    // Operations (verification, marketplace, queues)
    {
      label: "Operations",
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
        { href: "/admin/mzansi-market", label: "Mzansi Market", icon: ShoppingBag },
        { href: "/admin/businesses", label: "Mzansi Business", icon: Building2 },
        { href: "/admin/tourism-events", label: "Tourism & Events", icon: TreePalm },
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
        {
          href: "/admin/support",
          label: "Support Inbox",
          icon: Inbox,
          badgeCount: newSupportRequests > 0 ? newSupportRequests : undefined,
        },
      ],
    },
    // Tools
    {
      label: "Tools",
      items: [{ href: "/admin/feature-flags", label: "Feature Flags", icon: ToggleLeft }],
    },
  ];
}

export function AdminSidebar({
  pendingVerifications = 0,
  openReports = 0,
  pendingModeration = 0,
  newSupportRequests = 0,
  userRole = "moderator",
  evidenceDeskEnabled = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  let sections: NavSection[];
  switch (userRole) {
    case "governance_controller":
      sections = buildGovernanceSections(newSupportRequests);
      break;
    case "admin":
      sections = buildAdminSections(
        pendingVerifications,
        openReports,
        pendingModeration,
        newSupportRequests,
        evidenceDeskEnabled
      );
      break;
    default:
      sections = buildModeratorSections(
        pendingVerifications,
        openReports,
        pendingModeration,
        newSupportRequests,
        evidenceDeskEnabled
      );
      break;
  }

  const navContent = (
    <>
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
    </>
  );

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <aside
        className={cn(
          "sticky top-[65px] hidden h-[calc(100vh-65px)] shrink-0 flex-col border-r bg-card transition-all duration-200 md:flex",
          collapsed ? "w-16" : "w-56"
        )}
      >
        {navContent}
      </aside>

      {/* Mobile drawer trigger — visible only on mobile */}
      <div className="md:hidden fixed bottom-20 right-4 z-40">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              size="icon"
              className="h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground"
              aria-label="Open admin menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0 pb-[env(safe-area-inset-bottom)]">
            <div className="flex h-full flex-col">{navContent}</div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}
