"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Award,
  BadgePercent,
  BarChart3,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Flag,
  Gavel,
  Gift,
  Handshake,
  Inbox,
  Landmark,
  LayoutDashboard,
  Menu,
  Receipt,
  Scale,
  ScrollText,
  ShoppingBag,
  ToggleLeft,
  TreePalm,
  TrendingUp,
  Users,
} from "lucide-react";
import { BrandShield } from "@/components/shared/brand-shield";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { navItemForPath, type NavIcon, type NavSectionView } from "@/lib/admin/nav";
import type { StaffNavCounts } from "@/lib/services/staff-dashboard";

const ICONS: Record<NavIcon, React.ElementType> = {
  home: LayoutDashboard,
  shield: BrandShield,
  eye: Eye,
  clock: Clock,
  flag: Flag,
  inbox: Inbox,
  shopping: ShoppingBag,
  building: Building2,
  palm: TreePalm,
  alert: AlertTriangle,
  scale: Scale,
  gavel: Gavel,
  file: FileText,
  users: Users,
  activity: Activity,
  scroll: ScrollText,
  chart: BarChart3,
  trending: TrendingUp,
  percent: BadgePercent,
  award: Award,
  landmark: Landmark,
  handshake: Handshake,
  receipt: Receipt,
  gift: Gift,
  toggle: ToggleLeft,
};

interface AdminNavProps {
  sections: NavSectionView[];
  counts: StaffNavCounts;
}

function NavList({
  sections,
  counts,
  collapsed = false,
  onNavigate,
}: AdminNavProps & { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const activeHref = navItemForPath(pathname)?.href;

  return (
    <nav aria-label="Admin" className="flex-1 overflow-y-auto py-3">
      {sections.map((section, index) => (
        <div key={section.id} className={cn(index > 0 && "mt-3")}>
          {collapsed ? (
            index > 0 && <div className="mx-3 mb-2 border-t" aria-hidden="true" />
          ) : (
            <p
              id={`admin-nav-${section.id}`}
              className="mb-1 px-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70"
            >
              {section.label}
            </p>
          )}
          <ul
            className="space-y-0.5 px-2"
            aria-labelledby={collapsed ? undefined : `admin-nav-${section.id}`}
          >
            {section.items.map((item) => {
              const Icon = ICONS[item.icon];
              const isActive = item.href === activeHref;
              const count = item.badge ? counts[item.badge] : undefined;
              const showCount = typeof count === "number" && count > 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={
                      collapsed || showCount
                        ? `${item.label}${showCount ? `, ${count} waiting` : ""}`
                        : undefined
                    }
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-primary/10 font-semibold text-primary ring-1 ring-primary/20"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {showCount &&
                      (collapsed ? (
                        <span
                          className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive"
                          aria-hidden="true"
                        />
                      ) : (
                        <span
                          className="min-w-[20px] rounded-full bg-destructive px-1.5 text-center text-[10px] font-bold leading-5 text-destructive-foreground"
                          aria-hidden="true"
                        >
                          {count > 99 ? "99+" : count}
                        </span>
                      ))}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop sidebar, built from the navigation registry for the viewer's role. */
export function AdminSidebar({ sections, counts }: AdminNavProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r bg-card transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <NavList sections={sections} counts={counts} collapsed={collapsed} />
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-11 w-full justify-center"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}

/** Menu button for the header on small screens; opens the same menu in a sheet. */
export function AdminMobileNav({ sections, counts }: AdminNavProps) {
  const [open, setOpen] = useState(false);
  const total = Object.values(counts).reduce<number>((sum, n) => sum + (n ?? 0), 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-11 w-11 md:hidden"
          aria-label={total > 0 ? `Open admin menu, ${total} items waiting` : "Open admin menu"}
        >
          <Menu className="h-5 w-5" />
          {total > 0 && (
            <span
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive"
              aria-hidden="true"
            />
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0 pb-[env(safe-area-inset-bottom)]">
        <SheetTitle className="sr-only">Admin menu</SheetTitle>
        <div className="flex h-full flex-col">
          <NavList sections={sections} counts={counts} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
