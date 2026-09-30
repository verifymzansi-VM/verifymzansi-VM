"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** "inverse" for dark-green brand surfaces. */
  tone?: "default" | "inverse";
}

export function Breadcrumbs({ items: rawItems, tone = "default" }: BreadcrumbsProps) {
  const inverse = tone === "inverse";
  const linkTone = inverse
    ? "hover:text-white focus-visible:ring-white focus-visible:ring-offset-brand-green-950"
    : "hover:text-brand-green-700 focus-visible:ring-ring dark:hover:text-brand-green-300";
  // The leading home icon already links to "/", so drop an explicit Home crumb.
  const items = rawItems.filter((item, index) => !(index === 0 && item.href === "/"));

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center gap-1 text-[13px]",
        inverse ? "text-white/65" : "text-muted-foreground"
      )}
    >
      <Link
        href="/"
        className={cn(
          "rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          linkTone
        )}
        aria-label="Home"
      >
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      {items.map((item, i) => (
        <Fragment key={i}>
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0",
              inverse ? "text-white/35" : "text-muted-foreground/50"
            )}
            aria-hidden="true"
          />
          {item.href ? (
            <Link
              href={item.href}
              className={cn(
                "max-w-[180px] truncate rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                linkTone
              )}
            >
              {item.label}
            </Link>
          ) : (
            <span
              aria-current="page"
              className={cn(
                "max-w-[180px] truncate font-semibold",
                inverse ? "text-white" : "text-foreground"
              )}
            >
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
