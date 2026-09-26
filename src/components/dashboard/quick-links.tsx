import Link from "next/link";
import { Building2, CreditCard, TreePalm, UserRound, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickLink {
  label: string;
  href: string;
  icon: React.ElementType;
  subtitle?: string;
  toneClassName: string;
}

interface QuickLinksProps {
  /** Current plan tier label (e.g. "Growth plan") shown under the billing link */
  planLabel?: string;
}

/** Secondary shortcuts beside the overview (posting and boosting live in the page header). */
export function QuickLinks({ planLabel }: QuickLinksProps) {
  const links: QuickLink[] = [
    {
      label: "Add your business",
      href: "/post/create-business",
      icon: Building2,
      toneClassName: "area-business-tile",
    },
    {
      label: "Post a stay or event",
      href: "/post/create-tourism",
      icon: TreePalm,
      toneClassName: "area-tourism-tile",
    },
    {
      label: "Plans and billing",
      subtitle: planLabel ?? "No paid plan yet",
      href: "/billing",
      icon: CreditCard,
      toneClassName:
        "bg-brand-gold-100 text-brand-gold-900 dark:bg-brand-gold-400/15 dark:text-brand-gold-200",
    },
    {
      label: "Profile and settings",
      href: "/dashboard/profile",
      icon: UserRound,
      toneClassName: "bg-muted text-foreground/80",
    },
  ];

  return (
    <section
      aria-labelledby="quick-links-title"
      className="rounded-2xl border border-border/70 bg-card elev-xs"
    >
      <h2
        id="quick-links-title"
        className="px-4 pb-1 pt-4 font-display text-base font-semibold sm:px-5"
      >
        Shortcuts
      </h2>
      <ul className="px-2 pb-2 sm:px-3">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="group flex min-h-12 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    link.toneClassName
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{link.label}</span>
                  {link.subtitle ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {link.subtitle}
                    </span>
                  ) : null}
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
