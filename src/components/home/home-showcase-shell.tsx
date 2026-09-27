import Link from "next/link";
import { useId, type ReactNode } from "react";
import { ArrowRight, Building2, ShoppingBag, TreePalm, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ShowcaseTone = "green" | "blue" | "teal";

/** Each area keeps its own colour, icon and one-line summary so the rows read at a glance. */
const toneStyles: Record<
  ShowcaseTone,
  {
    icon: LucideIcon;
    summary: string;
    iconClassName: string;
    linkClassName: string;
  }
> = {
  green: {
    icon: ShoppingBag,
    summary: "Buy and sell locally",
    iconClassName:
      "bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-300",
    linkClassName:
      "text-brand-green-700 hover:text-brand-green-800 dark:text-brand-green-300 dark:hover:text-brand-green-200",
  },
  blue: {
    icon: Building2,
    summary: "Shops, trades and services",
    iconClassName:
      "bg-brand-blue/10 text-brand-blue-700 dark:bg-brand-blue/15 dark:text-brand-blue-300",
    linkClassName:
      "text-brand-blue-700 hover:text-brand-blue-800 dark:text-brand-blue-300 dark:hover:text-brand-blue-200",
  },
  teal: {
    icon: TreePalm,
    summary: "Stays, places and things to do",
    iconClassName: "bg-teal-500/10 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
    linkClassName: "text-teal-700 hover:text-teal-800 dark:text-teal-300 dark:hover:text-teal-200",
  },
};

interface HomeShowcaseShellProps {
  title: string;
  href: string;
  tone: ShowcaseTone;
  children: ReactNode;
  className?: string;
}

export function HomeShowcaseShell({
  title,
  href,
  tone,
  children,
  className,
}: HomeShowcaseShellProps) {
  const { icon: Icon, summary, iconClassName, linkClassName } = toneStyles[tone];
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn("home-rail py-6 sm:py-8 lg:py-10", className)}
    >
      <div className="container-page">
        <div className="mb-4 flex items-center justify-between gap-4 sm:mb-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span
              aria-hidden="true"
              className={cn(
                "home-rail-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12",
                iconClassName
              )}
            >
              <Icon className="h-5 w-5 sm:h-[22px] sm:w-[22px]" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              <h2
                id={headingId}
                className="truncate font-display text-lg font-bold leading-tight tracking-tight text-foreground sm:text-2xl"
              >
                {title}
              </h2>
              <p className="mt-0.5 truncate text-[13px] leading-snug text-muted-foreground sm:text-sm">
                {summary}
              </p>
            </div>
          </div>

          <Link
            href={href}
            prefetch={false}
            aria-label={`View all ${title}`}
            className={cn(
              "home-link-arrow inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              linkClassName
            )}
          >
            View all
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>

        <div className="relative">{children}</div>
      </div>
    </section>
  );
}
