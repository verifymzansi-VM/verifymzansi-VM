"use client";

import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, RotateCw, SearchX, SlidersHorizontal } from "lucide-react";
import { BrandSurface } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SearchBar,
  isSearchable,
  searchHref,
  withSearchFilters,
  type SearchFilters,
} from "./search-bar";
import { SearchResultCard, SearchResultCardSkeleton } from "./search-result-card";
import { SearchStart } from "./search-start";
import {
  POPULAR_SEARCHES,
  SOURCES,
  isValidResult,
  matchPages,
  toCardData,
  type Result,
  type Source,
} from "./search-sources";

const PAGE_SIZE = 12;

/**
 * "All" shows the first few results of each area. Phones show 3, two-column
 * tablets 4, three-column laptops 3 and wide screens 4, so rows stay full.
 */
const PREVIEW_SIZE = 4;
const PREVIEW_ITEM_CLASS = ["", "", "", "max-sm:hidden lg:max-xl:hidden"];

export type SearchAreaKey = Source["key"] | "pages";
type SearchTab = SearchAreaKey | "all";

/** null while loading, "error" when the source failed, otherwise the total. */
type SourceSummary = number | "error" | null;

/** preview: a few results under "All"; full: the area's own tab; hidden: another tab is open. */
type ResultsView = "preview" | "full" | "hidden";

function resultsLabel(count: number) {
  return `${count} ${count === 1 ? "result" : "results"}`;
}

function SectionHeading({
  id,
  label,
  icon: Icon,
  tileClassName,
  onSeeAll,
}: {
  id: string;
  label: string;
  icon: Source["icon"];
  tileClassName: string;
  onSeeAll?: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          tileClassName
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <h2
        id={id}
        className="min-w-0 flex-1 font-display text-lg font-bold tracking-tight text-foreground sm:text-xl"
      >
        {label}
      </h2>
      {onSeeAll ? (
        <button type="button" onClick={onSeeAll} className="link-arrow min-h-11 shrink-0 px-2">
          See all <span className="sr-only">{label} results</span>
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function SearchResults({
  source,
  query,
  province,
  city,
  org,
  view,
  onSummary,
  onSeeAll,
}: {
  source: Source;
  query: string;
  province?: string;
  city?: string;
  org?: string;
  view: ResultsView;
  onSummary?: (key: Source["key"], summary: SourceSummary) => void;
  onSeeAll: () => void;
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

  // Back on "All", the preview starts from the first page again.
  const [lastView, setLastView] = useState(view);
  if (view !== lastView) {
    setLastView(view);
    if (view === "preview" && page !== 1) {
      setState({ rows: [], total: 0, loading: true, error: false });
      setPage(1);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
      setState({ rows: [], total: 0, loading: false, error: true });
    }, 15_000);
    const params = new URLSearchParams({ q: query, page: String(page), limit: String(PAGE_SIZE) });
    if (province) params.set("province", province);
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
  }, [source.key, query, province, city, org, page, attempt]);

  const summary: SourceSummary = state.loading ? null : state.error ? "error" : state.total;
  useEffect(() => {
    onSummary?.(source.key, summary);
  }, [onSummary, source.key, summary]);

  function changePage(next: number) {
    setState({ rows: [], total: 0, loading: true, error: false });
    setPage(next);
    sectionRef.current?.scrollIntoView?.({ block: "start" });
  }

  const preview = view === "preview";
  const isEmpty = !state.loading && !state.error && state.rows.length === 0;
  const rows = preview ? state.rows.slice(0, PREVIEW_SIZE) : state.rows;
  const pageCount = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  // The area page carries on with the same words and location.
  const filters = { province, city, org };
  const includeOrg = source.key === "businesses";
  const browseHref = withSearchFilters(
    `${source.browseHref}?${new URLSearchParams({ q: query })}`,
    filters,
    includeOrg
  );
  const headingId = `results-${source.key}-title`;

  return (
    <section
      ref={sectionRef}
      id={`results-${source.key}`}
      className="scroll-mt-36"
      aria-labelledby={headingId}
      aria-busy={state.loading}
      // An empty area adds nothing to "All"; its tab still shows the 0.
      hidden={view === "hidden" || (preview && isEmpty)}
    >
      {preview ? (
        <SectionHeading
          id={headingId}
          label={source.label}
          icon={source.icon}
          tileClassName={source.tileClassName}
          onSeeAll={!state.loading && !state.error && state.total > 3 ? onSeeAll : undefined}
        />
      ) : (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <h2 id={headingId} className="sr-only">
            {source.label}
          </h2>
          {!state.loading && !state.error && !isEmpty ? (
            <Link
              href={browseHref}
              prefetch={false}
              className="pill-link ml-auto min-h-11"
              title={`Category, price and more filters in ${source.label}`}
            >
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              More filters in {source.label}
            </Link>
          ) : null}
        </div>
      )}
      <p role="status" className="sr-only">
        {state.loading
          ? `Searching ${source.label}…`
          : state.error
            ? "Search unavailable"
            : resultsLabel(state.total)}
      </p>

      <AnalyticsImpressions
        items={view === "hidden" ? [] : rows.map((row) => ({ table: source.key, id: row.id }))}
        type="search_appearance"
        surface="site_search"
      />

      <div className="mt-3">
        {state.loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: PREVIEW_SIZE }).map((_, index) => (
              <div key={index} className={PREVIEW_ITEM_CLASS[index]}>
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
              No matches in {source.label}. Try a broader word or check the spelling.
            </p>
            <Link
              href={withSearchFilters(source.browseHref, filters, includeOrg)}
              prefetch={false}
              className="pill-link min-h-11 shrink-0 self-start sm:self-auto"
            >
              {source.browseLabel}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {rows.map((row, index) => (
              <li key={row.id} className={preview ? PREVIEW_ITEM_CLASS[index] : undefined}>
                <SearchResultCard item={toCardData(source, row)} area={source} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {!preview && !state.loading && !state.error && state.total > PAGE_SIZE ? (
        <nav
          aria-label={`${source.label} result pages`}
          className="mt-5 flex items-center justify-between gap-3 sm:justify-center"
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
      ) : null}
    </section>
  );
}

function PageResults({
  pages,
  view,
  onSeeAll,
}: {
  pages: ReturnType<typeof matchPages>;
  view: ResultsView;
  onSeeAll: () => void;
}) {
  const preview = view === "preview";
  const shown = preview ? pages.slice(0, 3) : pages;
  return (
    <section
      id="results-pages"
      aria-labelledby="results-pages-title"
      className="scroll-mt-36"
      hidden={view === "hidden"}
    >
      {preview ? (
        <SectionHeading
          id="results-pages-title"
          label="Help & website pages"
          icon={FileText}
          tileClassName="bg-muted text-foreground/75"
          onSeeAll={pages.length > 3 ? onSeeAll : undefined}
        />
      ) : (
        <h2 id="results-pages-title" className="sr-only">
          Help &amp; website pages
        </h2>
      )}
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((page) => (
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
  );
}

function NoResults({ query, hasFilters }: { query: string; hasFilters: boolean }) {
  return (
    <div className="mx-auto max-w-lg py-6 text-center">
      <div className="empty-state-icon" aria-hidden="true">
        <SearchX className="h-6 w-6" />
      </div>
      <p className="mt-4 font-display text-lg font-bold text-foreground">
        Nothing found for “{query}”
      </p>
      <p className="mt-1 text-[15px] leading-6 text-muted-foreground">
        Check the spelling or try a broader word
        {hasFilters ? ", or clear your filters." : "."}
      </p>
      {hasFilters ? (
        <Button asChild variant="outline" className="mt-4 h-11 rounded-full px-5">
          <Link href={searchHref({ q: query })}>Clear filters</Link>
        </Button>
      ) : null}
      <ul className="mt-5 flex flex-wrap justify-center gap-2">
        {POPULAR_SEARCHES.map((term) => (
          <li key={term}>
            <Link href={searchHref({ q: term })} prefetch={false} className="pill-link min-h-11">
              {term}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteSearch({
  query,
  province = "",
  city = "",
  org = "",
  area,
}: {
  query: string;
  province?: string;
  city?: string;
  org?: string;
  /** Opens one area's tab instead of "All". */
  area?: SearchAreaKey;
}) {
  const resultsRef = useRef<HTMLDivElement>(null);
  const tabListRef = useRef<HTMLUListElement>(null);
  const [tab, setTab] = useState<SearchTab>(area ?? "all");
  // What the bar shows. Results use the applied filters from the URL (props).
  const [filters, setFilters] = useState<SearchFilters>({ province, city, org });
  const [summaries, setSummaries] = useState<Partial<Record<Source["key"], SourceSummary>>>({});
  const handleSummary = useCallback((key: Source["key"], summary: SourceSummary) => {
    setSummaries((current) =>
      current[key] === summary ? current : { ...current, [key]: summary }
    );
  }, []);

  // A Business Sponsor filter only applies to businesses.
  const sources = org ? SOURCES.filter((source) => source.key === "businesses") : SOURCES;
  const hasSearchableText = isSearchable(query);
  const pages = matchPages(query);
  const isSearching = Boolean(query) && hasSearchableText;
  const hasFilters = Boolean(province || city || org);

  const tabs: Array<{ key: SearchTab; label: string; count: SourceSummary }> = [
    ...sources.map((source) => ({
      key: source.key,
      label: source.label,
      count: summaries[source.key] ?? null,
    })),
    ...(pages.length ? [{ key: "pages" as const, label: "Help pages", count: pages.length }] : []),
  ];
  const counts = tabs.map((item) => item.count);
  const numbers = counts.filter((count): count is number => typeof count === "number");
  // "All" counts what it knows: an area that failed shows its own "!" and retry.
  const allCount: SourceSummary = counts.includes(null)
    ? null
    : numbers.length
      ? numbers.reduce((sum, count) => sum + count, 0)
      : "error";
  const activeTab: SearchTab = tabs.some((item) => item.key === tab) ? tab : "all";
  const nothingFound = activeTab === "all" && counts.every((count) => count === 0);

  // On phones the tabs scroll sideways: keep the open one in view.
  useEffect(() => {
    const list = tabListRef.current;
    const active = list?.querySelector<HTMLElement>('[aria-pressed="true"]')?.parentElement;
    if (!list || !active) return;
    const start = active.offsetLeft - list.offsetLeft;
    if (
      start < list.scrollLeft ||
      start + active.offsetWidth > list.scrollLeft + list.clientWidth
    ) {
      list.scrollLeft = Math.max(0, start - 16);
    }
  }, [activeTab]);

  function selectTab(next: SearchTab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "all") url.searchParams.delete("area");
    else url.searchParams.set("area", next);
    window.history.replaceState(null, "", url);
    const top = resultsRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) resultsRef.current?.scrollIntoView?.({ block: "start" });
  }

  function viewFor(key: SearchAreaKey): ResultsView {
    if (activeTab === "all") return "preview";
    return activeTab === key ? "full" : "hidden";
  }

  return (
    <div>
      <BrandSurface as="section" aria-labelledby="search-page-title">
        <div
          className={cn(
            "container-page relative pb-6",
            isSearching ? "pt-3 sm:pb-7 sm:pt-5" : "pt-3 sm:pb-9 sm:pt-7"
          )}
        >
          <h1
            id="search-page-title"
            className={
              isSearching
                ? "sr-only"
                : "font-display text-[1.75rem] font-bold leading-tight tracking-[-0.03em] text-white sm:text-[2rem]"
            }
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
            <p className="mt-1 hidden text-base text-white/75 sm:block">
              Listings, businesses, stays, events and help pages.
            </p>
          )}

          <SearchBar
            query={query}
            filters={filters}
            onFiltersChange={setFilters}
            showPopular={!isSearching}
          />

          {isSearching ? (
            <nav aria-label="Result areas" className="-mx-4 mt-3 sm:mx-0">
              <ul
                ref={tabListRef}
                className="flex gap-2 overflow-x-auto px-4 scrollbar-hide sm:flex-wrap sm:px-0"
              >
                {[{ key: "all" as const, label: "All", count: allCount }, ...tabs].map((item) => {
                  const active = activeTab === item.key;
                  return (
                    <li key={item.key} className="shrink-0">
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => selectTab(item.key)}
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300",
                          active
                            ? "border-white bg-white text-brand-green-900"
                            : "border-white/15 bg-white/10 text-white hover:bg-white/20"
                        )}
                      >
                        {item.label}{" "}
                        <span
                          className={cn(
                            "min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-bold",
                            active ? "bg-brand-green-50 text-brand-green-800" : "bg-white/15"
                          )}
                        >
                          {typeof item.count === "number"
                            ? item.count
                            : item.count === "error"
                              ? "!"
                              : "…"}{" "}
                          <span className="sr-only">
                            {typeof item.count === "number"
                              ? item.count === 1
                                ? "result"
                                : "results"
                              : item.count === "error"
                                ? "search failed"
                                : "loading"}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
        </div>
      </BrandSurface>

      <div ref={resultsRef} className="container-page scroll-mt-20 py-4 sm:py-7">
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
          <div className="space-y-8 sm:space-y-10">
            {nothingFound ? <NoResults query={query} hasFilters={hasFilters} /> : null}
            {sources.map((source) => (
              <SearchResults
                key={`${source.key}:${query}:${province}:${city}:${org}`}
                source={source}
                query={query}
                province={province || undefined}
                city={city || undefined}
                org={org || undefined}
                view={viewFor(source.key)}
                onSummary={handleSummary}
                onSeeAll={() => selectTab(source.key)}
              />
            ))}
            {pages.length ? (
              <PageResults
                pages={pages}
                view={viewFor("pages")}
                onSeeAll={() => selectTab("pages")}
              />
            ) : null}
          </div>
        ) : (
          <SearchStart filters={filters} />
        )}
      </div>
    </div>
  );
}
