import type { ReactNode } from "react";
import { AlertTriangle, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type GridStateTone = "green" | "blue" | "teal";
type GridStateKind = "empty" | "filtered-empty" | "error";

// "teal" is the historical name for the Tourism & Events tone (now Sunset Coral).
const toneTileClasses: Record<GridStateTone, string> = {
  green: "area-market-tile",
  blue: "area-business-tile",
  teal: "area-tourism-tile",
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
      className="flex flex-col items-center justify-center rounded-3xl border border-border/70 bg-card px-5 py-10 text-center elev-xs sm:px-8 sm:py-12"
      data-testid={testId}
      data-grid-state={state}
      role={isError ? "alert" : undefined}
    >
      <div
        aria-hidden="true"
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl [&_svg]:h-7 [&_svg]:w-7",
          isError
            ? "bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300"
            : toneTileClasses[tone]
        )}
      >
        {icon ? icon : isError ? <AlertTriangle /> : <PackageOpen />}
      </div>

      <div className="mt-4 max-w-md space-y-1.5">
        <p className="font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {title}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">{body}</p>
        {isError && errorCode ? (
          <Badge variant="outline" className="mt-1 font-mono text-[10px]">
            {errorCode}
          </Badge>
        ) : null}
      </div>

      {children ? (
        <div className="mt-6 flex w-full flex-col items-stretch justify-center gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}
