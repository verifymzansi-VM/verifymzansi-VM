import Link from "next/link";
import { ShoppingBag, MessageSquare, Building2, TreePalm } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatChip {
  label: string;
  value: number;
  href: string;
  icon: React.ElementType;
  toneClassName: string;
  /** Highlight the chip (e.g. unread leads waiting) */
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
    label: "Live posts",
    value: counts.liveListings,
    href: "/dashboard/listings",
    icon: ShoppingBag,
    toneClassName: "area-market-tile",
  },
  {
    label: "New leads",
    value: counts.unreadLeads,
    href: "/dashboard/leads",
    icon: MessageSquare,
    toneClassName:
      "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200",
    notify: counts.unreadLeads > 0,
  },
  {
    label: "Businesses",
    value: counts.businesses,
    href: "/dashboard/businesses",
    icon: Building2,
    toneClassName: "area-business-tile",
  },
  {
    label: "Tourism & Events",
    value: counts.activePromos,
    href: "/dashboard/tourism-events",
    icon: TreePalm,
    toneClassName: "area-tourism-tile",
  },
];

export { defaultChips };

export function StatChips({ chips }: StatChipsProps) {
  return (
    <section aria-label="Account stats">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {chips.map((chip) => {
          const Icon = chip.icon;
          return (
            <li key={chip.href}>
              <Link
                href={chip.href}
                className={cn(
                  "group flex h-full items-center gap-3 rounded-2xl border bg-card p-3.5 elev-xs transition-colors duration-200 sm:p-4",
                  "hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  chip.notify ? "border-brand-gold-400/70" : "border-border/70"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    chip.toneClassName
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {chip.notify ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-gold-500 ring-2 ring-card" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-xl font-bold leading-none tracking-tight tabular-nums text-foreground sm:text-2xl">
                    {chip.value}
                  </span>
                  <span className="mt-1 block truncate text-xs font-medium text-muted-foreground sm:text-sm">
                    {chip.label}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
