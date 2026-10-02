"use client";

import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  FileText,
  MapPin,
  RotateCw,
  Search,
  SearchX,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { BrandSurface } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SearchResultCard, SearchResultCardSkeleton } from "./search-result-card";
import { SearchStart } from "./search-start";
import {
  SOURCES,
  isValidResult,
  matchPages,
  toCardData,
  type Result,
  type Source,
} from "./search-sources";

const PAGE_SIZE = 12;

/** null while loading, "error" when the source failed, otherwise the total. */
type SourceSummary = number | "error" | null;

function searchHref(params: { q: string; city?: string; org?: string }) {
  const search = new URLSearchParams({ q: params.q });
  if (params.city) search.set("city", params.city);
  if (params.org) search.set("org", params.org);
  return `/search?${search}`;
}

function resultsLabel(count: number) {
  return `${count} ${count === 1 ? "result" : "results"}`;
}

function SearchResults({
  source,
  query,
  city,
  org,
  onSummary,
}: {
  source: Source;
  query: string;
  city?: string;
  org?: string;
  onSummary?: (key: Source["key"], summary: SourceSummary) => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    rows: Result[];
    total: number;
    loading: boolean;
    error: boolean;
  }>({ rows: [], total: 0, loading: true, error: false });
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setState({ rows: [], total: 0, loading: false, error: true });
    }, 15_000);
    const params = new URLSearchParams({ q: query, page: String(page), limit: String(PAGE_SIZE) });
    if (city) params.set("city", city);
    if (org) params.set("org", org);
    fetch(`/api/${source.key}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Search unavailable");
        const data = await response.json();
        if (
          !Array.isArray(data[source.key]) ||
          !data[source.key].every(isValidResult) ||
          !Number.isSafeInteger(data.total) ||
          data.total < 0
        )
          throw new Error("Invalid search results");
        if (!controller.signal.aborted)
          setState({
            rows: data[source.key],
            total: data.total ?? 0,
            loading: false,
            error: false,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({ rows: [], total: 0, loading: false, error: true });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [source.key, query, city, org, page, attempt]);

  const summary: SourceSummary = state.loading ? null : state.error ? "error" : state.total;
  useEffect(() => {
    onSummary?.(source.key, summary);
  }, [onSummary, source.key, summary]);

  function changePage(next: number) {
    setState({ rows: [], total: 0, loading: true, error: false });
    setPage(next);
    sectionRef.current?.scrollIntoView?.({ block: "start" });
  }

  const Icon = source.icon;
  const pageCount = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  const firstShown = (page - 1) * PAGE_SIZE + 1;
  const lastShown = firstShown + state.rows.length - 1;
  const browseHref = `${source.browseHref}?${new URLSearchParams({ q: query })}`;
  const isEmpty = !state.loading && !state.error && state.rows.length === 0;

  return (
    <section
      ref={sectionRef}
      id={`results-${source.key}`}
      className="scroll-mt-36"
      aria-label={source.label}
      aria-busy={state.loading}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            source.tileClassName
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {source.label}
          </h2>
          <p role="status" className="text-sm text-muted-foreground">
            {state.loading
              ? `Searching ${source.label}…`
              : state.error
                ? "Search unavailable"
                : state.rows.length === 0
                  ? "No matches"
                  : state.total > PAGE_SIZE
                    ? `Showing ${firstShown}–${lastShown} of ${state.total} results`
                    : resultsLabel(state.total)}
          </p>
        </div>
        {!state.loading && !state.error && state.rows.length > 0 ? (
          <div className="hidden shrink-0 sm:block">
            <Link href={browseHref} prefetch={false} className="link-arrow min-h-11 px-2">
              See all in {source.label}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        ) : null}
      </div>

      <AnalyticsImpressions
        items={state.rows.map((row) => ({ table: source.key, id: row.id }))}
        type="search_appearance"
        surface="site_search"
      />

      <div className="mt-4">
        {state.loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className={cn(index >= 2 && "hidden sm:block", index >= 3 && "lg:hidden xl:block")}
              >
                <SearchResultCardSkeleton />
              </div>
            ))}
          </div>
        ) : state.error ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-brand-red/25 bg-brand-red/5 p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-brand-red/10">
            <p className="text-sm leading-6 text-foreground">Could not search {source.label}.</p>
            <Button
              variant="outline"
              className="h-11 shrink-0 rounded-full px-5"
              onClick={() => {
                setState({ ...state, loading: true, error: false });
                setAttempt(attempt + 1);
              }}
            >
              <RotateCw aria-hidden="true" className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-muted-foreground">
              Try a broader word or check the spelling.
            </p>
            <Link
              href={source.browseHref}
              prefetch={false}
              className="pill-link min-h-11 shrink-0 self-start sm:self-auto"
            >
              {source.browseLabel}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {state.rows.map((row) => (
              <li key={row.id}>
                <SearchResultCard item={toCardData(source, row)} area={source} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {!state.loading && !state.error && (page > 1 || page * PAGE_SIZE < state.total) && (
        <nav
          aria-label={`${source.label} result pages`}
          className="mt-4 flex items-center justify-between gap-3 sm:justify-start"
        >
          <Button
            variant="outline"
            className="h-11 rounded-full px-5"
            disabled={page === 1}
            onClick={() => changePage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            className="h-11 rounded-full px-5"
            disabled={page * PAGE_SIZE >= state.total}
            onClick={() => changePage(page + 1)}
          >
            Next
          </Button>
        </nav>
      )}

      {!state.loading && !state.error && state.rows.length > 0 ? (
        <div className="mt-3 sm:hidden">
          <Link href={browseHref} prefetch={false} className="link-arrow min-h-11">
            See all in {source.label}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </div>
      ) : null}
    </section>
  );
}

/** Optional filters: town/city (all sections) and organisation programme (businesses). */
function useSearchOrganisations(enabled: boolean): Array<{ slug: string; name: string }> {
  const [organisations, setOrganisations] = useState<Array<{ slug: string; name: string }>>([]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/organisations/search?purpose=filter", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { organisations: [] }))
      .then((data: { organisations?: Array<{ slug: string; name: string }> }) =>
        setOrganisations((data.organisations ?? []).map(({ slug, name }) => ({ slug, name })))
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [enabled]);
  return organisations;
}

function humanizeSlug(slug: string) {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SiteSearch({
  query,
  city = "",
  org = "",
}: {
  query: string;
  city?: string;
  org?: string;
}) {
  const [filtersOpen, setFiltersOpen] = useState(Boolean(city || org));
  const organisations = useSearchOrganisations(filtersOpen);
  const [summaries, setSummaries] = useState<Partial<Record<Source["key"], SourceSummary>>>({});
  const handleSummary = useCallback((key: Source["key"], summary: SourceSummary) => {
    setSummaries((current) =>
      current[key] === summary ? current : { ...current, [key]: summary }
    );
  }, []);

  const sources = org ? SOURCES.filter((source) => source.key === "businesses") : SOURCES;
  const hasSearchableText = /[\p{L}\p{N}]/u.test(query);
  const pages = matchPages(query);
  const isSearching = Boolean(query) && hasSearchableText;
  const activeFilterCount = (city ? 1 : 0) + (org ? 1 : 0);
  const orgName = organisations.find((item) => item.slug === org)?.name ?? humanizeSlug(org);

  return (
    <div>
      <BrandSurface as="section" aria-labelledby="search-page-title">
        <div className="container-page relative pb-8 pt-6 sm:pb-11 sm:pt-9">
          <h1
            id="search-page-title"
            className="break-words font-display text-[1.75rem] font-bold leading-[1.1] tracking-tight text-white sm:text-[2.25rem]"
          >
            {isSearching ? (
              <>Results for “{query}”</>
            ) : (
              <>
                Search <span className="gold-shine text-brand-gold-300">VerifyMzansi</span>
              </>
            )}
          </h1>
          {isSearching ? null : (
            <p className="mt-2 text-sm text-white/75 sm:text-base">
              Listings, businesses, stays, events and help pages.
            </p>
          )}

          <form action="/search" role="search" className="mt-5 max-w-3xl">
            <label htmlFor="site-search" className="sr-only">
              Search the website
            </label>
            <div className="group relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground sm:left-5"
              />
              <input
                id="site-search"
                type="search"
                name="q"
                defaultValue={query}
                maxLength={100}
                required
                autoComplete="off"
                enterKeyHint="search"
                placeholder="What are you looking for?"
                className="h-14 w-full rounded-full border border-border bg-card pl-12 pr-[6.5rem] text-base text-foreground shadow-lg shadow-black/5 transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/20 focus:border-brand-green/50 focus:outline-none focus:ring-4 focus:ring-brand-green/15 sm:h-16 sm:pl-[3.25rem] sm:pr-32 sm:text-[17px] [&::-webkit-search-cancel-button]:hidden"
              />
              <Button
                type="submit"
                variant="trust-verified"
                className="absolute right-2 top-1/2 h-11 -translate-y-1/2 rounded-full px-5 sm:h-12 sm:px-6"
              >
                Search
              </Button>
            </div>

            <details
              className="group/filters mt-3"
              open={filtersOpen}
              onToggle={(event) => setFiltersOpen((event.currentTarget as HTMLDetailsElement).open)}
            >
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-foreground/85 transition-colors hover:border-foreground/25 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                More filters
                {activeFilterCount ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-green-600 px-1.5 text-xs font-bold text-white dark:bg-brand-green-500 dark:text-brand-green-950">
                    <span className="sr-only">(</span>
                    {activeFilterCount}
                    <span className="sr-only"> active)</span>
                  </span>
                ) : null}
                <ChevronDown
                  aria-hidden="true"
                  className="h-4 w-4 transition-transform duration-200 group-open/filters:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <div className="mt-3 grid gap-4 rounded-2xl border border-border/70 bg-card p-4 text-foreground elev-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div>
                  <label htmlFor="site-search-city" className="mb-1.5 block text-sm font-medium">
                    Location (optional)
                  </label>
                  <Input
                    id="site-search-city"
                    name="city"
                    defaultValue={city}
                    maxLength={60}
                    autoComplete="address-level2"
                    placeholder="e.g. Richards Bay"
                    className="h-11 rounded-xl"
                  />
                </div>
                {organisations.length > 0 ? (
                  <div>
                    <label htmlFor="site-search-org" className="mb-1.5 block text-sm font-medium">
                      Organisation / Programme
                    </label>
                    <select
                      id="site-search-org"
                      name="org"
                      defaultValue={org}
                      className="flex h-11 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="">All businesses</option>
                      {organisations.map((item) => (
                        <option key={item.slug} value={item.slug}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="hidden sm:block" />
                )}
                <Button type="submit" variant="outline" className="h-11 rounded-xl px-5">
                  Apply filters
                </Button>
              </div>
            </details>
          </form>

          {isSearching && activeFilterCount ? (
            <ul aria-label="Active filters" className="mt-3 flex flex-wrap gap-2">
              {city ? (
                <li>
                  <Link
                    href={searchHref({ q: query, org })}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/10 py-1 pl-3 pr-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
                  >
                    <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                    {city}
                    <X aria-hidden="true" className="h-4 w-4" />
                    <span className="sr-only">Remove location filter</span>
                  </Link>
                </li>
              ) : null}
              {org ? (
                <li>
                  <Link
                    href={searchHref({ q: query, city })}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/10 py-1 pl-3 pr-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
                  >
                    {orgName}
                    <X aria-hidden="true" className="h-4 w-4" />
                    <span className="sr-only">Remove organisation filter</span>
                  </Link>
                </li>
              ) : null}
            </ul>
          ) : null}

          {isSearching ? (
            <nav aria-label="Jump to results" className="-mx-4 mt-5 sm:mx-0">
              <ul className="flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:flex-wrap sm:px-0">
                {sources.map((source) => {
                  const value = summaries[source.key];
                  return (
                    <li key={source.key} className="shrink-0">
                      <a href={`#results-${source.key}`} className="pill-link min-h-11">
                        {source.label}
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground/80">
                          {typeof value === "number" ? value : value === "error" ? "!" : "…"}
                          <span className="sr-only">
                            {typeof value === "number"
                              ? ` ${value === 1 ? "result" : "results"}`
                              : value === "error"
                                ? " search failed"
                                : " loading"}
                          </span>
                        </span>
                      </a>
                    </li>
                  );
                })}
                {pages.length ? (
                  <li className="shrink-0">
                    <a href="#results-pages" className="pill-link min-h-11">
                      Help pages
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground/80">
                        {pages.length}
                      </span>
                    </a>
                  </li>
                ) : null}
              </ul>
            </nav>
          ) : null}
        </div>
      </BrandSurface>

      <div className="container-page py-8 sm:py-10">
        {query && !hasSearchableText ? (
          <div className="mx-auto max-w-md text-center">
            <div className="empty-state-icon" aria-hidden="true">
              <SearchX className="h-6 w-6" />
            </div>
            <p role="status" className="mt-4 text-[15px] leading-6 text-muted-foreground">
              Enter at least one letter or number to search.
            </p>
          </div>
        ) : query ? (
          <div className="space-y-10 sm:space-y-12">
            {sources.map((source) => (
              <SearchResults
                key={`${source.key}:${query}:${city}:${org}`}
                source={source}
                query={query}
                city={city || undefined}
                org={org || undefined}
                onSummary={handleSummary}
              />
            ))}
            {pages.length ? (
              <section
                id="results-pages"
                aria-labelledby="results-pages-title"
                className="scroll-mt-36"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground/75"
                  >
                    <FileText className="h-5 w-5" />
                  </span>
                  <div>
                    <h2
                      id="results-pages-title"
                      className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl"
                    >
                      Help & website pages
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {pages.length} {pages.length === 1 ? "page matches" : "pages match"}
                    </p>
                  </div>
                </div>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pages.map((page) => (
                    <li key={page.href}>
                      <Link
                        href={page.href}
                        className="flex h-full min-h-11 items-start justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-foreground">{page.title}</span>
                          <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">
                            {page.description}
                          </span>
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : (
          <SearchStart />
        )}
      </div>
    </div>
  );
}
