import Link from "next/link";
import { ShoppingBag, MessageSquare, Building2, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatChip {
  label: string;
  value: number;
  href: string;
  icon: React.ElementType;
  toneClassName: string;
  /** Show a red notification dot when true */
  notify?: boolean;
}

interface StatChipsProps {
  chips: StatChip[];
}

const defaultChips = (counts: {
  liveListings: number;
  unreadLeads: number;
  businesses: number;
  activePromos: number;
}): StatChip[] => [
  {
    label: "Live Posts",
    value: counts.liveListings,
    href: "/dashboard/listings",
    icon: ShoppingBag,
    toneClassName:
      "bg-brand-green-50 text-brand-green dark:bg-brand-green-950 dark:text-brand-green-100",
  },
  {
    label: "New Leads",
    value: counts.unreadLeads,
    href: "/dashboard/leads",
    icon: MessageSquare,
    toneClassName: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-100",
    notify: counts.unreadLeads > 0,
  },
  {
    label: "Businesses",
    value: counts.businesses,
    href: "/dashboard/businesses",
    icon: Building2,
    toneClassName: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-100",
  },
  {
    label: "Promos",
    value: counts.activePromos,
    href: "/dashboard/promotions",
    icon: Megaphone,
    toneClassName: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-100",
  },
];

export { defaultChips };

export function StatChips({ chips }: StatChipsProps) {
  return (
    <nav
      className="flex gap-3 overflow-x-auto pb-1 scrollbar-none snap-x snap-mandatory sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0"
      aria-label="Account stats"
    >
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <Link
            key={chip.href}
            href={chip.href}
            className={cn(
              "relative flex min-w-[7rem] snap-start items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3.5 py-3 transition-all",
              "hover:border-foreground/15 hover:shadow-md active:scale-[0.97]",
              "sm:min-w-0"
            )}
          >
            {/* Notification dot */}
            {chip.notify && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-red ring-2 ring-card" />
            )}

            <div
              className={cn(
                "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                chip.toneClassName
              )}
            >
              <Icon className="h-4 w-4" />
            </div>

            <div className="min-w-0">
              <p className="font-display text-lg font-bold leading-tight tracking-tight">
                {chip.value}
              </p>
              <p className="text-[11px] font-medium text-muted-foreground leading-tight">
                {chip.label}
              </p>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
