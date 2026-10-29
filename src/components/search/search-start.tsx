import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { withSearchFilters, type SearchFilters } from "./search-bar";
import { AREA_SHORTCUTS, HELP_SHORTCUTS, SOURCES } from "./search-sources";

const AREA_NAMES: Record<(typeof SOURCES)[number]["key"], string> = {
  listings: "Mzansi Market",
  businesses: "Mzansi Business",
  promotions: "Tourism & Events",
};

/**
 * Zero-query state for /search, sized to fit one screen with the search band:
 * one row per area (the area itself, then its main categories) and the help
 * pages people most often look for. Popular searches sit in the band. Area
 * links keep the location picked in the search bar.
 */
export function SearchStart({ filters }: { filters: SearchFilters }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-10">
      <section aria-labelledby="browse-areas-title" className="min-w-0">
        <h2
          id="browse-areas-title"
          className="font-display text-base font-bold tracking-tight text-foreground sm:text-lg"
        >
          Browse by area
        </h2>
        <ul className="mt-2 space-y-2.5 sm:mt-3">
          {SOURCES.map((source) => {
            const Icon = source.icon;
            const areaHref = (href: string) =>
              withSearchFilters(href, filters, source.key === "businesses");
            return (
              <li
                key={source.key}
                className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:flex-wrap sm:px-0"
              >
                <Link
                  href={areaHref(source.browseHref)}
                  prefetch={false}
                  className={cn(
                    "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full py-1 pl-1.5 pr-3.5 text-sm font-semibold transition-[filter] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:hover:brightness-125",
                    source.tileClassName
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-card/80"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {AREA_NAMES[source.key]}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <ul className="flex gap-2 sm:flex-wrap">
                  {AREA_SHORTCUTS[source.key].links.map((link) => (
                    <li key={link.href} className="shrink-0">
                      <Link
                        href={areaHref(link.href)}
                        prefetch={false}
                        className="pill-link min-h-11"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="search-help-title"
        className="min-w-0 lg:border-l lg:border-border/70 lg:pl-8"
      >
        <h2
          id="search-help-title"
          className="font-display text-base font-bold tracking-tight text-foreground sm:text-lg"
        >
          Help & safety
        </h2>
        <ul className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:mt-3 sm:flex-wrap sm:px-0 lg:flex-col lg:gap-0.5">
          {HELP_SHORTCUTS.map((link) => {
            const Icon = link.icon;
            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  prefetch={false}
                  className="pill-link min-h-11 lg:w-full lg:rounded-xl lg:border-transparent lg:bg-transparent lg:px-2.5"
                >
                  <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
