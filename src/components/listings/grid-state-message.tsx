import type { ReactNode } from "react";
import { AlertTriangle, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type GridStateTone = "green" | "blue" | "teal";
type GridStateKind = "empty" | "filtered-empty" | "error";

const toneTileClasses: Record<GridStateTone, string> = {
  green:
    "bg-brand-green-50 ring-brand-green/10 dark:bg-brand-green-950/60 dark:ring-brand-green/20",
  blue: "bg-brand-blue/10 ring-brand-blue/15 dark:bg-brand-blue/15 dark:ring-brand-blue/25",
  teal: "bg-teal-500/10 ring-teal-500/15 dark:bg-teal-500/15 dark:ring-teal-400/25",
};

const toneIconClasses: Record<GridStateTone, string> = {
  green: "text-brand-green",
  blue: "text-brand-blue",
  teal: "text-teal-600 dark:text-teal-300",
};

interface GridStateMessageProps {
  /** Visual area accent for the icon tile. */
  tone?: GridStateTone;
  /** Drives the default icon and the data-grid-state attribute. */
  state: GridStateKind;
  title: string;
  body: string;
  /** Area-specific icon (Building2, TreePalm, …). Defaults to PackageOpen / AlertTriangle. */
  icon?: ReactNode;
  /** Optional diagnostic code shown as a small badge (e.g. PostgREST error codes). */
  errorCode?: string;
  /** data-testid for the wrapper, e.g. "mzansi-market-grid-empty". */
  testId?: string;
  /** Actions rendered below the copy (retry, clear filters, create CTAs). */
  children?: ReactNode;
}

/**
 * Shared empty / no-results / error state for marketplace grids so every area
 * communicates loading outcomes with the same calm, consistent pattern.
 */
export function GridStateMessage({
  tone = "green",
  state,
  title,
  body,
  icon,
  errorCode,
  testId,
  children,
}: GridStateMessageProps) {
  const isError = state === "error";

  return (
    <div
      className="flex flex-col items-center justify-center space-y-4 py-10 sm:py-14"
      data-testid={testId}
      data-grid-state={state}
    >
      <div className={cn("rounded-2xl p-4 ring-1", toneTileClasses[tone])}>
        {icon ? (
          icon
        ) : isError ? (
          <AlertTriangle className="h-7 w-7 text-amber-500" />
        ) : (
          <PackageOpen className={cn("h-7 w-7", toneIconClasses[tone])} />
        )}
      </div>

      <div className="max-w-md space-y-1.5 text-center">
        <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
        {isError && errorCode ? (
          <Badge variant="outline" className="mt-1 font-mono text-[10px]">
            {errorCode}
          </Badge>
        ) : null}
      </div>

      {children ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
      ) : null}
    </div>
  );
}
