import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Building2, ShoppingBag, TreePalm } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandShield } from "@/components/shared/brand-shield";
import { cn } from "@/lib/utils";

export type AreaHeroArea = "market" | "business" | "tourism";

const AREA_STYLES: Record<
  AreaHeroArea,
  { icon: typeof ShoppingBag; tile: string; glow: string; button: string; kicker: string }
> = {
  market: {
    icon: ShoppingBag,
    tile: "area-market-tile",
    glow: "from-brand-green-100/70 dark:from-brand-green-950/60",
    button:
      "bg-brand-green-600 text-white hover:bg-brand-green-700 dark:bg-brand-green-500 dark:text-brand-green-950 dark:hover:bg-brand-green-400",
    kicker: "text-brand-green-700 dark:text-brand-green-300",
  },
  business: {
    icon: Building2,
    tile: "area-business-tile",
    glow: "from-brand-blue-100/70 dark:from-brand-blue-950/60",
    button:
      "bg-brand-blue-600 text-white hover:bg-brand-blue-700 dark:bg-brand-blue-500 dark:hover:bg-brand-blue-400",
    kicker: "text-brand-blue-700 dark:text-brand-blue-300",
  },
  tourism: {
    icon: TreePalm,
    tile: "area-tourism-tile",
    glow: "from-sunset-100/80 dark:from-sunset-950/50",
    button:
      "bg-sunset-600 text-white hover:bg-sunset-700 dark:bg-sunset-500 dark:hover:bg-sunset-400",
    kicker: "text-sunset-700 dark:text-sunset-300",
  },
};

export interface AreaHeroLink {
  label: string;
  href: string;
}

interface AreaHeroProps {
  area: AreaHeroArea;
  title: string;
  description: string;
  /** Short line under the title that names who posts here. */
  trustLine: string;
  ctaHref: string;
  ctaLabel: string;
  quickLinks?: readonly AreaHeroLink[];
  children?: ReactNode;
}

/**
 * Compact, colour-coded intro for each product area: what it is, who posts
 * there, a primary action and one-tap category shortcuts.
 */
export function AreaHero({
  area,
  title,
  description,
  trustLine,
  ctaHref,
  ctaLabel,
  quickLinks = [],
  children,
}: AreaHeroProps) {
  const styles = AREA_STYLES[area];
  const Icon = styles.icon;

  return (
    <section
      aria-labelledby={`${area}-area-title`}
      className="relative overflow-hidden border-b border-border/60"
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent",
          styles.glow
        )}
      />
      <div
        aria-hidden="true"
        className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.05] dark:invert [mask-image:linear-gradient(to_left,black,transparent_70%)]"
      />
      <div className="container-page relative py-6 sm:py-9">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span
              aria-hidden="true"
              className={cn(
                "hidden h-14 w-14 shrink-0 items-center justify-center rounded-2xl sm:flex",
                styles.tile
              )}
            >
              <Icon className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <h1
                id={`${area}-area-title`}
                className="font-display text-[2rem] font-extrabold leading-none tracking-tight text-foreground sm:text-[2.6rem]"
              >
                {title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                {description}
              </p>
              <p
                className={cn(
                  "mt-2 inline-flex items-center gap-1.5 text-xs font-semibold sm:text-sm",
                  styles.kicker
                )}
              >
                <BrandShield className="h-4 w-4" />
                {trustLine}
              </p>
            </div>
          </div>
          <Button
            asChild
            className={cn("h-11 w-full shrink-0 rounded-full px-5 sm:w-auto", styles.button)}
          >
            <Link href={ctaHref} prefetch={false}>
              {ctaLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {quickLinks.length > 0 ? (
          <nav aria-label={`Popular in ${title}`} className="-mx-4 mt-5 sm:mx-0">
            <ul className="flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:flex-wrap sm:px-0">
              {quickLinks.map((link) => (
                <li key={link.href} className="shrink-0">
                  <Link href={link.href} prefetch={false} className="pill-link">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {children}
      </div>
    </section>
  );
}
