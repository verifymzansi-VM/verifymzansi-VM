import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type StatePanelTone = "error" | "neutral";

const TONE_TILE: Record<StatePanelTone, string> = {
  error: "bg-brand-red/10 text-brand-red-700 dark:bg-brand-red/15 dark:text-brand-red-300",
  neutral: "area-market-tile",
};

interface StatePanelProps {
  /** Lucide icon (or any node) shown in the tinted tile. */
  icon: ReactNode;
  tone?: StatePanelTone;
  /** Short informative label above the title, e.g. "Error 404". */
  eyebrow?: string;
  title: string;
  /** One short line. */
  description: ReactNode;
  /** Primary + optional secondary action (buttons or links). */
  actions?: ReactNode;
  /** Adds a compact site search and a support link below the actions. */
  showNextSteps?: boolean;
  /** Unique id for the next-steps search input. */
  searchInputId?: string;
  /** Small print below everything (error reference, technical details). */
  footnote?: ReactNode;
  className?: string;
}

/**
 * Shared layout for full-page error, not-found and unavailable states:
 * short title, one line, one clear action, and a search box so nobody hits a
 * dead end.
 */
export function StatePanel({
  icon,
  tone = "neutral",
  eyebrow,
  title,
  description,
  actions,
  showNextSteps = false,
  searchInputId = "state-panel-search",
  footnote,
  className,
}: StatePanelProps) {
  return (
    <div className={cn("hero-panel w-full max-w-md", className)}>
      <div className="flex flex-col items-center px-5 pb-7 pt-8 text-center sm:px-8">
        <div
          aria-hidden="true"
          className={cn(
            "flex h-14 w-14 items-center justify-center rounded-2xl [&_svg]:h-7 [&_svg]:w-7",
            TONE_TILE[tone]
          )}
        >
          {icon}
        </div>
        {eyebrow ? (
          <p className="mt-4 text-sm font-semibold text-muted-foreground">{eyebrow}</p>
        ) : null}
        <h1
          className={cn(
            "font-display text-2xl font-bold leading-tight tracking-tight text-foreground",
            eyebrow ? "mt-1" : "mt-4"
          )}
        >
          {title}
        </h1>
        <div className="mt-2 max-w-sm text-[15px] leading-6 text-muted-foreground">
          {description}
        </div>
        {actions ? (
          <div className="mt-6 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:justify-center [&>*]:h-11 [&>*]:w-full [&>*]:rounded-full sm:[&>*]:w-auto">
            {actions}
          </div>
        ) : null}
      </div>

      {showNextSteps ? (
        <div className="border-t border-border/70 bg-muted/35 px-5 py-5 sm:px-8">
          <form action="/search" method="get" role="search" aria-label="Search VerifyMzansi">
            <label htmlFor={searchInputId} className="sr-only">
              Search VerifyMzansi
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id={searchInputId}
                type="search"
                name="q"
                required
                maxLength={100}
                autoComplete="off"
                enterKeyHint="search"
                placeholder="Search VerifyMzansi"
                className="h-11 w-full rounded-full border border-input bg-card pl-10 pr-4 text-[15px] text-foreground placeholder:text-muted-foreground/80 focus:border-brand-green/50 focus:outline-none focus:ring-4 focus:ring-brand-green/15"
              />
            </div>
          </form>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Need help?{" "}
            <Link
              href="/contact"
              prefetch={false}
              className="inline-flex min-h-11 items-center font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
            >
              Contact support
            </Link>
          </p>
        </div>
      ) : null}

      {footnote ? (
        <div className="border-t border-border/70 px-5 py-3 text-xs leading-5 text-muted-foreground sm:px-8">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Centres a StatePanel in the available page space. Pass `withinLayoutMain`
 * when the route's layout already renders the header and `<main>` landmark.
 */
export function StatePanelPage({
  children,
  withinLayoutMain = false,
}: {
  children: ReactNode;
  withinLayoutMain?: boolean;
}) {
  const className =
    "container-page flex flex-1 items-start justify-center py-8 sm:items-center sm:py-14";
  if (withinLayoutMain) {
    return <div className={cn(className, "min-h-[60vh] bg-hero-mesh")}>{children}</div>;
  }
  return (
    <main id="main-content" className={className}>
      {children}
    </main>
  );
}
