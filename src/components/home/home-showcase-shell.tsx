"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ShowcaseTone = "green" | "blue" | "teal";

const toneStyles: Record<
  ShowcaseTone,
  {
    badgeClassName: string;
    linkClassName: string;
    barClassName: string;
  }
> = {
  green: {
    badgeClassName: "text-brand-green-700 dark:text-brand-green-300",
    linkClassName:
      "text-brand-green-700 hover:bg-brand-green/10 dark:text-brand-green-300 dark:hover:bg-brand-green/15",
    barClassName: "bg-brand-green-600",
  },
  blue: {
    badgeClassName: "text-brand-blue-700 dark:text-brand-blue-300",
    linkClassName:
      "text-brand-blue-700 hover:bg-brand-blue/10 dark:text-brand-blue-300 dark:hover:bg-brand-blue/15",
    barClassName: "bg-brand-blue-600",
  },
  teal: {
    badgeClassName: "text-sunset-700 dark:text-sunset-300",
    linkClassName:
      "text-sunset-700 hover:bg-sunset/10 dark:text-sunset-300 dark:hover:bg-sunset/15",
    barClassName: "bg-sunset-600",
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
    <section className={cn("relative py-8 sm:py-10", className)}>
      <div className="container-page">
        <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
          <div className="min-w-0 max-w-2xl">
            <p
              className={cn(
                "flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]",
                styles.badgeClassName
              )}
            >
              <span
                aria-hidden="true"
                className={cn("h-1.5 w-5 rounded-full", styles.barClassName)}
              />
              {icon ? <span className="flex items-center justify-center">{icon}</span> : null}
              <span>{badge}</span>
            </p>
            <h2 className="section-title mt-2">{title}</h2>
            <p className="section-lede">{description}</p>
          </div>

          <Link
            href={href}
            prefetch={false}
            className={cn(
              "group/link -mr-2 inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:mr-0 sm:gap-1.5 sm:px-3.5",
              styles.linkClassName
            )}
          >
            {ctaLabel}
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/link:translate-x-0.5" />
          </Link>
        </div>

        <div className="relative">{children}</div>
      </div>
    </section>
  );
}
