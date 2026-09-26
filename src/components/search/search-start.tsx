import Link from "next/link";
import { ArrowRight, LifeBuoy, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { AREA_SHORTCUTS, HELP_SHORTCUTS, POPULAR_SEARCHES, SOURCES } from "./search-sources";

/**
 * Zero-query state for /search: popular searches, a way into each area, and
 * the help pages people most often look for.
 */
export function SearchStart() {
  return (
    <div className="space-y-10 sm:space-y-12">
      <section aria-labelledby="popular-searches-title">
        <h2
          id="popular-searches-title"
          className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl"
        >
          Popular searches
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {POPULAR_SEARCHES.map((term) => (
            <li key={term}>
              <Link
                href={`/search?${new URLSearchParams({ q: term })}`}
                prefetch={false}
                className="pill-link min-h-11"
              >
                <Search aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
                {term}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="browse-areas-title">
        <h2
          id="browse-areas-title"
          className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl"
        >
          Browse by area
        </h2>
        <ul className="mt-4 grid gap-4 md:grid-cols-3">
          {SOURCES.map((source) => {
            const Icon = source.icon;
            const shortcuts = AREA_SHORTCUTS[source.key];
            return (
              <li key={source.key} className="surface-card flex flex-col p-5">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      source.tileClassName
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
                    {source.key === "businesses" ? "Mzansi Business" : source.label}
                  </h3>
                </div>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {shortcuts.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} prefetch={false} className="pill-link">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link
                  href={source.browseHref}
                  prefetch={false}
                  className="link-arrow mt-auto min-h-11 self-start pt-4"
                >
                  {source.browseLabel}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="search-help-title"
        className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-muted/40 p-5 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-foreground/75"
          >
            <LifeBuoy className="h-5 w-5" />
          </span>
          <div>
            <h2 id="search-help-title" className="font-display text-lg font-bold text-foreground">
              Help & safety
            </h2>
          </div>
        </div>
        <ul className="flex flex-wrap gap-2">
          {HELP_SHORTCUTS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} prefetch={false} className="pill-link min-h-11">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
