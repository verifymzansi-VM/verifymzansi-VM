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
    panelClassName:
      "bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(246,252,248,0.96))] dark:bg-[linear-gradient(145deg,rgba(10,18,14,0.95),rgba(7,15,12,0.96))] border-brand-green/15",
    badgeClassName:
      "bg-brand-green/10 text-brand-green-800 dark:bg-brand-green/15 dark:text-brand-green-100",
    headingClassName: "text-brand-green-950 dark:text-brand-green-50",
    linkClassName: "text-brand-green hover:text-brand-green-700 dark:hover:text-brand-green-300",
    glowClassName: "bg-brand-green/20",
  },
  blue: {
    panelClassName:
      "bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(244,249,255,0.96))] dark:bg-[linear-gradient(145deg,rgba(10,16,24,0.95),rgba(8,13,21,0.96))] border-brand-blue/15",
    badgeClassName:
      "bg-brand-blue/10 text-brand-blue-800 dark:bg-brand-blue/15 dark:text-brand-blue-100",
    headingClassName: "text-slate-950 dark:text-slate-50",
    linkClassName: "text-brand-blue hover:text-brand-blue/80 dark:hover:text-brand-blue/70",
    glowClassName: "bg-brand-blue/20",
  },
  teal: {
    panelClassName:
      "bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(243,252,251,0.96))] dark:bg-[linear-gradient(145deg,rgba(7,18,18,0.95),rgba(6,14,14,0.96))] border-teal-500/15",
    badgeClassName: "bg-teal-500/10 text-teal-800 dark:bg-teal-500/15 dark:text-teal-100",
    headingClassName: "text-slate-950 dark:text-slate-50",
    linkClassName: "text-teal-700 hover:text-teal-800 dark:hover:text-teal-300",
    glowClassName: "bg-teal-400/20",
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
    <section className={cn("relative py-5 sm:py-6 lg:py-8", className)}>
      <div className="container-page">
        <div
          className={cn(
            "group relative overflow-hidden rounded-[2rem] border shadow-[0_24px_64px_-44px_rgba(15,23,42,0.4)] transition-shadow duration-500 hover:shadow-[0_32px_72px_-44px_rgba(15,23,42,0.45)]",
            styles.panelClassName
          )}
        >
          <div
            className={cn(
              "pointer-events-none absolute -right-12 top-0 h-48 w-48 rounded-full blur-3xl",
              styles.glowClassName
            )}
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/15"
            aria-hidden="true"
          />

          <div className="relative flex flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl space-y-3">
                <div
                  className={cn(
                    "inline-flex w-fit items-center gap-2 rounded-full border border-black/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] shadow-sm dark:border-white/10",
                    styles.badgeClassName
                  )}
                >
                  {icon ? <span className="flex items-center justify-center">{icon}</span> : null}
                  <span>{badge}</span>
                </div>

                <div className="space-y-2">
                  <h2
                    className={cn(
                      "font-display text-[1.9rem] font-bold tracking-tight sm:text-[2.2rem] lg:text-[2.45rem]",
                      styles.headingClassName
                    )}
                  >
                    {title}
                  </h2>
                  <p className="max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300 sm:text-base">
                    {description}
                  </p>
                </div>
              </div>

              <Link
                href={href}
                prefetch={false}
                className={cn(
                  "group/link inline-flex shrink-0 items-center gap-2 rounded-full border border-current/15 px-4 py-2 text-sm font-semibold transition-all duration-200 hover:gap-3 hover:bg-current/5",
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
