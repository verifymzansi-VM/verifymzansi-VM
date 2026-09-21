"use client";

import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";
import { Fragment } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-[13px] text-muted-foreground"
    >
      <Link
        href="/"
        className="rounded-sm transition-colors hover:text-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:text-brand-green-300"
        aria-label="Home"
      >
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      {items.map((item, i) => (
        <Fragment key={i}>
          <ChevronRight
            className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50"
            aria-hidden="true"
          />
          {item.href ? (
            <Link
              href={item.href}
              className="max-w-[180px] truncate rounded-sm font-medium transition-colors hover:text-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:text-brand-green-300"
            >
              {item.label}
            </Link>
          ) : (
            <span className="max-w-[180px] truncate font-semibold text-foreground">
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
