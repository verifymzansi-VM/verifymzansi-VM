"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ShowcaseTone = "green" | "blue" | "teal";

const toneStyles: Record<
  ShowcaseTone,
  {
    panelClassName: string;
    badgeClassName: string;
    headingClassName: string;
    linkClassName: string;
    glowClassName: string;
  }
> = {
  green: {
    panelClassName: "bg-card dark:bg-card border-brand-green/15",
    badgeClassName:
      "bg-brand-green/5 text-brand-green-800 dark:bg-brand-green/10 dark:text-brand-green-100 border-brand-green/20",
    headingClassName: "text-foreground",
    linkClassName: "text-brand-green hover:text-brand-green-700 dark:hover:text-brand-green-300",
    glowClassName: "bg-brand-green/10",
  },
  blue: {
    panelClassName: "bg-card dark:bg-card border-brand-blue/15",
    badgeClassName:
      "bg-brand-blue/5 text-brand-blue-800 dark:bg-brand-blue/10 dark:text-brand-blue-100 border-brand-blue/20",
    headingClassName: "text-foreground",
    linkClassName: "text-brand-blue hover:text-brand-blue/80 dark:hover:text-brand-blue/70",
    glowClassName: "bg-brand-blue/10",
  },
  teal: {
    panelClassName: "bg-card dark:bg-card border-teal-500/15",
    badgeClassName:
      "bg-teal-500/5 text-teal-800 dark:bg-teal-500/10 dark:text-teal-100 border-teal-500/20",
    headingClassName: "text-foreground",
    linkClassName: "text-teal-700 hover:text-teal-800 dark:hover:text-teal-300",
    glowClassName: "bg-teal-400/10",
  },
};

interface HomeShowcaseShellProps {
  badge: string;
  title: string;
  description: string;
  href: string;
  ctaLabel: string;
  tone: ShowcaseTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function HomeShowcaseShell({
  badge,
  title,
  description,
  href,
  ctaLabel,
  tone,
  icon,
  children,
  className,
}: HomeShowcaseShellProps) {
  const styles = toneStyles[tone];

  return (
    <section className={cn("relative py-8 sm:py-10 lg:py-12", className)}>
      <div className="container-page">
        <div
          className={cn(
            "group relative overflow-hidden rounded-3xl border elev-sm transition-all duration-300 hover:elev-md",
            styles.panelClassName
          )}
        >
          <div
            className={cn(
              "pointer-events-none absolute -right-16 top-0 h-56 w-56 rounded-full blur-3xl opacity-60",
              styles.glowClassName
            )}
            aria-hidden="true"
          />

          <div className="relative flex flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-9">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl space-y-3.5">
                <div
                  className={cn(
                    "inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em]",
                    styles.badgeClassName
                  )}
                >
                  {icon ? <span className="flex items-center justify-center">{icon}</span> : null}
                  <span>{badge}</span>
                </div>

                <div className="space-y-2.5">
                  <h2
                    className={cn(
                      "font-display text-[1.9rem] font-bold leading-[1.08] tracking-tight sm:text-[2.2rem] lg:text-[2.45rem]",
                      styles.headingClassName
                    )}
                  >
                    {title}
                  </h2>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                    {description}
                  </p>
                </div>
              </div>

              <Link
                href={href}
                prefetch={false}
                className={cn(
                  "group/link inline-flex shrink-0 items-center gap-2 rounded-full border border-current/15 px-4 py-2 text-sm font-semibold transition-all duration-200 hover:gap-3 hover:border-current/25 hover:bg-current/5",
                  styles.linkClassName
                )}
              >
                {ctaLabel}
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/link:translate-x-0.5" />
              </Link>
            </div>

            <div className="relative">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
