"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Building2, ShoppingBag, TreePalm, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ShowcaseTone = "green" | "blue" | "teal";

/** Each area keeps its own colour and icon so the rows read at a glance. */
const toneIcons: Record<ShowcaseTone, { icon: LucideIcon; tileClassName: string }> = {
  green: { icon: ShoppingBag, tileClassName: "bg-brand-green-600 text-white" },
  blue: { icon: Building2, tileClassName: "bg-brand-blue-600 text-white" },
  teal: { icon: TreePalm, tileClassName: "bg-teal-600 text-white" },
};

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
    linkClassName:
      "text-brand-green-700 hover:text-brand-green-800 dark:text-brand-green-300 dark:hover:text-brand-green-200",
    glowClassName: "bg-brand-green/10",
  },
  blue: {
    panelClassName: "bg-card dark:bg-card border-brand-blue/15",
    badgeClassName:
      "bg-brand-blue/5 text-brand-blue-800 dark:bg-brand-blue/10 dark:text-brand-blue-100 border-brand-blue/20",
    headingClassName: "text-foreground",
    linkClassName:
      "text-brand-blue-700 hover:text-brand-blue-800 dark:text-brand-blue-300 dark:hover:text-brand-blue-200",
    glowClassName: "bg-brand-blue/10",
  },
  teal: {
    panelClassName: "bg-card dark:bg-card border-teal-500/15",
    badgeClassName:
      "bg-teal-500/5 text-teal-800 dark:bg-teal-500/10 dark:text-teal-100 border-teal-500/20",
    headingClassName: "text-foreground",
    linkClassName: "text-teal-700 hover:text-teal-800 dark:text-teal-300 dark:hover:text-teal-200",
    glowClassName: "bg-teal-400/10",
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
  const styles = toneStyles[tone];
  const { icon: Icon, tileClassName } = toneIcons[tone];

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

          <div className="relative flex flex-col gap-5 px-2 py-5 sm:px-8 sm:py-7 lg:px-10 lg:py-8">
            <div className="flex items-center justify-between gap-3 px-2 sm:px-0">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm sm:h-11 sm:w-11",
                    tileClassName
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h2
                  className={cn(
                    "min-w-0 font-display text-xl font-bold leading-tight tracking-tight sm:text-3xl",
                    styles.headingClassName
                  )}
                >
                  {title}
                </h2>
              </div>

              <Link
                href={href}
                prefetch={false}
                aria-label={`View all ${title}`}
                className={cn(
                  "group/link inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-current/15 px-4 text-sm font-semibold transition-all duration-200 hover:gap-2.5 hover:border-current/25 hover:bg-current/5",
                  styles.linkClassName
                )}
              >
                View all
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform duration-200 group-hover/link:translate-x-0.5"
                />
              </Link>
            </div>

            <div className="relative">{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
