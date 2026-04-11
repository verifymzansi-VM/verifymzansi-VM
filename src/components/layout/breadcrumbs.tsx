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
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link
        href="/"
        className="rounded-sm hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="Home"
      >
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      {items.map((item, i) => (
        <Fragment key={i}>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {item.href ? (
            <Link
              href={item.href}
              className="rounded-sm hover:text-foreground transition-colors truncate max-w-[180px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground font-medium truncate max-w-[180px]">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
