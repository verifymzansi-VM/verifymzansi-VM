import type { ReactNode } from "react";
import { AlertTriangle, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type GridStateTone = "green" | "blue" | "teal";
type GridStateKind = "empty" | "filtered-empty" | "error";

const toneTileClasses: Record<GridStateTone, string> = {
  green:
    "bg-brand-green-50 text-brand-green ring-brand-green/15 dark:bg-brand-green-950/60 dark:ring-brand-green/25",
  blue: "bg-brand-blue/10 text-brand-blue ring-brand-blue/20 dark:bg-brand-blue/15 dark:ring-brand-blue/30",
  teal: "bg-teal-500/10 text-teal-600 ring-teal-500/20 dark:bg-teal-500/15 dark:text-teal-300 dark:ring-teal-400/30",
};

const tonePanelClasses: Record<GridStateTone, string> = {
  green:
    "border-brand-green/25 bg-gradient-to-b from-brand-green-50/60 to-transparent dark:from-brand-green-950/30",
  blue: "border-brand-blue/25 bg-gradient-to-b from-brand-blue/5 to-transparent dark:from-brand-blue/10",
  teal: "border-teal-500/25 bg-gradient-to-b from-teal-500/5 to-transparent dark:from-teal-500/10",
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
      className={cn(
        "flex flex-col items-center justify-center space-y-5 rounded-3xl border border-dashed px-6 py-12 text-center sm:py-16",
        isError
          ? "border-destructive/30 bg-gradient-to-b from-destructive/5 to-transparent"
          : tonePanelClasses[tone]
      )}
      data-testid={testId}
      data-grid-state={state}
    >
      <div
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-2xl ring-1 elev-xs",
          isError ? "bg-amber-500/10 text-amber-500 ring-amber-500/25" : toneTileClasses[tone]
        )}
      >
        {icon ? (
          icon
        ) : isError ? (
          <AlertTriangle className="h-8 w-8" />
        ) : (
          <PackageOpen className={cn("h-8 w-8", toneIconClasses[tone])} />
        )}
      </div>

      <div className="max-w-md space-y-1.5 text-center">
        <p className="font-display text-lg font-semibold tracking-tight sm:text-xl">{title}</p>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
        {isError && errorCode ? (
          <Badge variant="outline" className="mt-1 font-mono text-[10px]">
            {errorCode}
          </Badge>
        ) : null}
      </div>

      {children ? (
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">{children}</div>
      ) : null}
    </div>
  );
}
