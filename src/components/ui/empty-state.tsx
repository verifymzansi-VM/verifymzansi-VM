import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import Link from "next/link";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 py-10 text-center px-4",
        className
      )}
    >
      {icon && <div className="mb-2 text-muted-foreground/30">{icon}</div>}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground/70 max-w-xs">{description}</p>
      )}
      {actionLabel && actionHref && (
        <Button asChild size="sm" className="mt-4">
          <Link href={actionHref}>{actionLabel}</Link>
        </Button>
      )}
    </div>
  );
}
