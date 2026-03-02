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
      <Link href="/" className="hover:text-foreground transition-colors" aria-label="Home">
        <Home className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
      {items.map((item, i) => (
        <Fragment key={i}>
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-foreground transition-colors truncate max-w-[180px]"
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
