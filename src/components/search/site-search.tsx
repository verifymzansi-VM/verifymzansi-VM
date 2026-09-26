"use client";

import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const SOURCES = [
  { key: "listings", label: "Mzansi Market" },
  { key: "businesses", label: "Businesses" },
  { key: "promotions", label: "Tourism & Events" },
] as const;
type Source = (typeof SOURCES)[number];
type Result = {
  id: string;
  title?: string;
  business_name?: string;
  description?: string;
  category?: string;
};
const PAGES = [
  {
    href: "/mzansi-market",
    title: "Mzansi Market",
    description: "Buy and sell products, vehicles, property and classifieds.",
  },
  {
    href: "/mzansi-business",
    title: "Mzansi Business",
    description: "Find local businesses and professional services.",
  },
  {
    href: "/tourism-events",
    title: "Tourism & Events",
    description: "Accommodation, restaurants, experiences, venues and events.",
  },
  {
    href: "/verification",
    title: "Verification",
    description: "Verify your identity, phone and account.",
  },
  { href: "/verify-buyer", title: "Verify a buyer", description: "Check buyer verification." },
  {
    href: "/help/verification",
    title: "Verification help",
    description: "Help with identity verification and documents.",
  },
  { href: "/pricing", title: "Pricing", description: "Plans, subscriptions, fees and payments." },
  { href: "/advertise", title: "Advertise", description: "Promote your business and posts." },
  {
    href: "/post/create",
    title: "Create a post",
    description: "Post a listing, business, tourism or event.",
  },
  {
    href: "/dashboard",
    title: "Dashboard",
    description: "Manage your account, posts, leads and settings.",
  },
  { href: "/contact", title: "Contact", description: "Contact support for help." },
  {
    href: "/trust-safety",
    title: "Trust & Safety",
    description: "Trust, accountability, refunds and safety policies.",
  },
  { href: "/safety", title: "Safety Centre", description: "Report problems, scams and appeals." },
  {
    href: "/safety/scam-alerts",
    title: "Scam Alerts",
    description: "Avoid fraud and common scams.",
  },
  {
    href: "/safety/meeting-checklist",
    title: "Meeting Safety Checklist",
    description: "Stay safe when meeting buyers and sellers.",
  },
  { href: "/terms", title: "Terms of Service", description: "Website rules and terms." },
  { href: "/privacy", title: "Privacy Policy", description: "Personal data protection and POPIA." },
  { href: "/paia", title: "PAIA Manual", description: "Access to information and records." },
  {
    href: "/dsar",
    title: "Data rights request",
    description: "Access, correct or delete your personal data.",
  },
];

function resultHref(source: Source, row: Result) {
  const base =
    source.key === "listings"
      ? "/listing"
      : source.key === "promotions" || row.category === "tourism_hospitality"
        ? "/tourism-events"
        : "/mzansi-business";
  return `${base}/${encodeURIComponent(row.id)}`;
}

function SearchResults({
  source,
  query,
  city,
  org,
}: {
  source: Source;
  query: string;
  city?: string;
  org?: string;
}) {
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
    const params = new URLSearchParams({ q: query, page: String(page), limit: "12" });
    if (city) params.set("city", city);
    if (org) params.set("org", org);
    fetch(`/api/${source.key}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Search unavailable");
        const data = await response.json();
        if (
          !Array.isArray(data[source.key]) ||
          !data[source.key].every(
            (row: Result | null) =>
              row &&
              typeof row.id === "string" &&
              (typeof row.title === "string" || typeof row.business_name === "string") &&
              (row.title == null || typeof row.title === "string") &&
              (row.business_name == null || typeof row.business_name === "string") &&
              (row.description == null || typeof row.description === "string")
          ) ||
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
  function changePage(next: number) {
    setState({ rows: [], total: 0, loading: true, error: false });
    setPage(next);
  }
  return (
    <section className="space-y-3" aria-label={source.label} aria-busy={state.loading}>
      <h2 className="text-xl font-semibold">{source.label}</h2>
      <div role="status">
        {state.loading ? (
          <p>Searching…</p>
        ) : state.error ? (
          <div>
            <p>Could not search {source.label}. Please try again.</p>
            <Button
              variant="outline"
              onClick={() => {
                setState({ ...state, loading: true, error: false });
                setAttempt(attempt + 1);
              }}
            >
              Retry
            </Button>
          </div>
        ) : state.rows.length === 0 ? (
          <p className="text-muted-foreground">No matches found.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Page {page} · {state.total} results
          </p>
        )}
      </div>
      <AnalyticsImpressions
        items={state.rows.map((row) => ({ table: source.key, id: row.id }))}
        type="search_appearance"
        surface="site_search"
      />
      <ul className="grid gap-3 sm:grid-cols-2">
        {state.rows.map((row) => (
          <li key={row.id}>
            <Link
              prefetch={false}
              href={resultHref(source, row)}
              className="block h-full break-words rounded-xl border p-4 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <h3 className="font-semibold">{row.business_name || row.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{row.description}</p>
            </Link>
          </li>
        ))}
      </ul>
      {!state.loading && !state.error && (page > 1 || page * 12 < state.total) && (
        <div className="flex gap-3">
          <Button variant="outline" disabled={page === 1} onClick={() => changePage(page - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={page * 12 >= state.total}
            onClick={() => changePage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
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
  const sources = org ? SOURCES.filter((source) => source.key === "businesses") : SOURCES;
  const hasSearchableText = /[\p{L}\p{N}]/u.test(query);
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const pages = PAGES.filter((page) =>
    words.every((word) => `${page.title} ${page.description}`.toLocaleLowerCase().includes(word))
  );
  return (
    <div className="mt-6 space-y-8">
      <form action="/search" role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="site-search" className="mb-2 block text-sm font-medium">
            Search the website
          </label>
          <Input
            id="site-search"
            type="search"
            name="q"
            defaultValue={query}
            maxLength={100}
            required
            placeholder="What are you looking for?"
          />
        </div>
        <details
          className="w-full text-sm"
          open={filtersOpen}
          onToggle={(event) => setFiltersOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-medium">More filters</summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-44">
              <label htmlFor="site-search-city" className="mb-2 block text-sm font-medium">
                Location (optional)
              </label>
              <Input
                id="site-search-city"
                name="city"
                defaultValue={city}
                maxLength={60}
                placeholder="e.g. Richards Bay"
              />
            </div>
            {organisations.length > 0 ? (
              <div className="w-full sm:w-56">
                <label htmlFor="site-search-org" className="mb-2 block text-sm font-medium">
                  Organisation / Programme
                </label>
                <select
                  id="site-search-org"
                  name="org"
                  defaultValue={org}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">All businesses</option>
                  {organisations.map((item) => (
                    <option key={item.slug} value={item.slug}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </details>
        <Button type="submit">
          <Search className="mr-2 h-4 w-4" />
          Search
        </Button>
      </form>
      {query && !hasSearchableText ? (
        <p role="status" className="text-muted-foreground">
          Enter at least one letter or number to search.
        </p>
      ) : query ? (
        <>
          <p>
            Results for <strong>“{query}”</strong>
          </p>
          {sources.map((source) => (
            <SearchResults
              key={`${source.key}:${query}:${city}:${org}`}
              source={source}
              query={query}
              city={city || undefined}
              org={org || undefined}
            />
          ))}
          <section aria-label="Website pages" className="space-y-3">
            <h2 className="text-xl font-semibold">Website pages</h2>
            {pages.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {pages.map((page) => (
                  <li key={page.href}>
                    <Link href={page.href} className="block rounded-xl border p-4 hover:bg-muted">
                      <h3 className="font-semibold">{page.title}</h3>
                      <p className="text-sm text-muted-foreground">{page.description}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No matching pages. Try a different keyword.</p>
            )}
          </section>
        </>
      ) : (
        <p className="text-muted-foreground">Enter a keyword to search across VerifyMzansi.</p>
      )}
    </div>
  );
}
