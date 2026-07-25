import Link from "next/link";
import { ShoppingBag, CreditCard, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickLink {
  label: string;
  href: string;
  icon: React.ElementType;
  subtitle?: string;
  toneClassName: string;
}

interface QuickLinksProps {
  /** Current plan tier label (e.g. "Growth") shown under Billing link */
  planLabel?: string;
}

export function QuickLinks({ planLabel }: QuickLinksProps) {
  const links: QuickLink[] = [
    {
      label: "My Posts",
      href: "/dashboard/listings",
      icon: ShoppingBag,
      toneClassName: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300",
    },
    {
      label: "Billing",
      subtitle: planLabel,
      href: "/billing",
      icon: CreditCard,
      toneClassName:
        "bg-brand-green-50 text-brand-green dark:bg-brand-green-950 dark:text-brand-green-300",
    },
    {
      label: "Profile",
      href: "/dashboard/profile",
      icon: User,
      toneClassName: "bg-warm-100 text-warm-600 dark:bg-warm-800 dark:text-warm-300",
    },
  ];

  return (
    <section className="space-y-3" aria-label="Quick links">
      <h2 className="font-display text-base font-semibold">Quick Links</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3.5 transition-all",
                "hover:border-foreground/20 hover:bg-accent/40 active:scale-[0.98]"
              )}
            >
              <div
                className={cn(
                  "inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg",
                  link.toneClassName
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{link.label}</p>
                {link.subtitle && (
                  <p className="text-[11px] text-muted-foreground leading-tight">{link.subtitle}</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
