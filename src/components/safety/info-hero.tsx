import type { ComponentType, ReactNode } from "react";
import { Breadcrumbs, type BreadcrumbItem } from "@/components/layout/breadcrumbs";
import { cn } from "@/lib/utils";

type InfoHeroTone = "green" | "gold" | "neutral";

const TONES: Record<InfoHeroTone, { glow: string; kicker: string }> = {
  green: {
    glow: "from-brand-green-100/70 dark:from-brand-green-950/60",
    kicker:
      "bg-brand-green/10 text-brand-green-800 dark:bg-brand-green/15 dark:text-brand-green-200",
  },
  gold: {
    glow: "from-brand-gold-100/70 dark:from-brand-gold-950/40",
    kicker: "bg-brand-gold/15 text-brand-gold-900 dark:bg-brand-gold/15 dark:text-brand-gold-200",
  },
  neutral: {
    glow: "from-warm-100/80 dark:from-warm-900/40",
    kicker: "bg-muted text-foreground/80",
  },
};

interface InfoHeroProps {
  title: string;
  description?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  kicker?: string;
  kickerIcon?: ComponentType<{ className?: string }>;
  /** Call-to-action buttons rendered under the description. */
  actions?: ReactNode;
  /** Optional visual shown beside the copy from `lg` upwards. */
  aside?: ReactNode;
  tone?: InfoHeroTone;
  className?: string;
}

/**
 * Soft, pattern-backed intro band for help, safety and legal pages. It keeps the
 * same rhythm as `AreaHero` (breadcrumbs → kicker → display h1 → lede → actions)
 * without the product-area colour coding.
 */
export function InfoHero({
  title,
  description,
  breadcrumbs,
  kicker,
  kickerIcon: KickerIcon,
  actions,
  aside,
  tone = "green",
  className,
}: InfoHeroProps) {
  const styles = TONES[tone];

  return (
    <section className={cn("relative overflow-hidden border-b border-border/60", className)}>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-b to-transparent",
          styles.glow
        )}
      />
      <div
        aria-hidden="true"
        className="mzansi-pattern pointer-events-none absolute inset-0 opacity-[0.03] [mask-image:linear-gradient(to_left,black,transparent_70%)] dark:opacity-[0.05] dark:invert"
      />
      <div className="container-page relative py-6 sm:py-10">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <div
          className={cn(
            "mt-4 grid gap-8",
            aside && "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center"
          )}
        >
          <div className="min-w-0">
            {kicker && (
              <p
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                  styles.kicker
                )}
              >
                {KickerIcon && <KickerIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                {kicker}
              </p>
            )}
            <h1
              className={cn(
                "font-display text-[1.75rem] font-bold leading-[1.1] tracking-tight text-foreground sm:text-[2.5rem]",
                kicker && "mt-3"
              )}
            >
              {title}
            </h1>
            {description && (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                {description}
              </p>
            )}
            {actions && <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div>}
          </div>
          {aside && <div className="hidden lg:block">{aside}</div>}
        </div>
      </div>
    </section>
  );
}

interface SectionHeadingProps {
  id: string;
  title: string;
  lede?: ReactNode;
  kicker?: string;
  className?: string;
}

/** `.section-title` + `.section-lede` pair with an id for `aria-labelledby`. */
export function SectionHeading({ id, title, lede, kicker, className }: SectionHeadingProps) {
  return (
    <div className={cn("max-w-3xl", className)}>
      {kicker && (
        <p className="text-sm font-semibold text-brand-green-700 dark:text-brand-green-300">
          {kicker}
        </p>
      )}
      <h2 id={id} className={cn("section-title", kicker && "mt-1.5")}>
        {title}
      </h2>
      {lede && <p className="section-lede">{lede}</p>}
    </div>
  );
}
