"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { BadgeCheck, ChevronDown, Loader2, MapPin, Search, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFilterOrganisations } from "@/hooks/use-filter-organisations";
import { getCitiesForProvince, getProvinceNames } from "@/lib/constants/sa-provinces";
import { cn } from "@/lib/utils";
import { POPULAR_SEARCHES } from "./search-sources";

export interface SearchFilters {
  province?: string;
  city?: string;
  org?: string;
}

export function searchHref(params: { q: string } & SearchFilters) {
  const search = new URLSearchParams({ q: params.q });
  if (params.province) search.set("province", params.province);
  if (params.city) search.set("city", params.city);
  if (params.org) search.set("org", params.org);
  return `/search?${search}`;
}

/**
 * Adds the location (and, for businesses, the sponsor) in use to a link into
 * an area, so leaving search does not drop the filters someone picked.
 */
export function withSearchFilters(href: string, filters: SearchFilters, includeOrg = false) {
  const [path, existing = ""] = href.split("?");
  const params = new URLSearchParams(existing);
  if (filters.province) params.set("province", filters.province);
  if (filters.city) params.set("city", filters.city);
  if (includeOrg && filters.org) params.set("org", filters.org);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function isSearchable(query: string) {
  return /[\p{L}\p{N}]/u.test(query);
}

function humanizeSlug(slug: string) {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A filter as a pill on phones (its own row under the search box) and as a
 * segment of the search bar from lg up. Empty values are not submitted, so
 * the URL only carries filters that are in use.
 *
 * A pick made with a mouse or finger applies at once. Arrow keys change a
 * closed select on Windows one step at a time, so a keyboard pick applies on
 * Enter or when focus leaves the select instead of on every step.
 */
function FilterSelect({
  id,
  name,
  label,
  icon: Icon,
  value,
  onChange,
  onApply,
  children,
}: {
  id: string;
  name: string;
  label: string;
  icon?: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  onApply: () => void;
  children: ReactNode;
}) {
  const fromKeyboard = useRef(false);
  const pending = useRef(false);
  function apply() {
    pending.current = false;
    onApply();
  }
  return (
    <div className="relative shrink-0 lg:border-l lg:border-border">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {Icon ? (
        <Icon
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2",
            value ? "text-brand-green-700 dark:text-brand-green-300" : "text-muted-foreground"
          )}
        />
      ) : null}
      <select
        id={id}
        name={value ? name : undefined}
        value={value}
        onPointerDown={() => {
          fromKeyboard.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && pending.current) {
            event.preventDefault();
            apply();
          } else if (event.key !== "Tab" && event.key !== "Shift") {
            fromKeyboard.current = true;
          }
        }}
        onBlur={() => {
          if (pending.current) apply();
        }}
        onChange={(event) => {
          onChange(event.target.value);
          if (fromKeyboard.current) pending.current = true;
          else apply();
        }}
        className={cn(
          "h-11 max-w-[13rem] cursor-pointer appearance-none truncate rounded-full border bg-card pr-9 text-sm font-medium text-foreground shadow-sm transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 lg:h-12 lg:max-w-[12.5rem] lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none lg:hover:bg-muted/60",
          Icon ? "pl-9" : "pl-4",
          value
            ? "border-brand-green-600 font-semibold text-brand-green-800 dark:border-brand-green-400 dark:text-brand-green-200"
            : "border-border"
        )}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

/**
 * The search box with its location and sponsor filters in one bar. Changing a
 * filter re-runs the current search straight away, the same as the filters on
 * the Market, Business and Tourism pages.
 */
export function SearchBar({
  query,
  filters,
  onFiltersChange,
  showPopular = false,
}: {
  query: string;
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  showPopular?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const organisations = useFilterOrganisations(true);
  const selectedProvince = filters.province ?? "";
  const selectedCity = filters.city ?? "";
  const selectedOrg = filters.org ?? "";

  // Desktop visitors came here to type; phones keep the keyboard closed so the
  // shortcuts below stay visible.
  useEffect(() => {
    if (!query && window.matchMedia?.("(pointer: fine)").matches) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [query]);

  // Back from the results page restores this page from the cache: stop the spinner.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const towns = selectedProvince ? getCitiesForProvince(selectedProvince) : [];
  const townOptions =
    selectedCity && !towns.includes(selectedCity) ? [selectedCity, ...towns] : towns;
  const selectedOrgListed = organisations.some((item) => item.slug === selectedOrg);

  function changeFilters(next: SearchFilters) {
    // Flush so the form holds the new values before it is submitted.
    flushSync(() => onFiltersChange({ ...filters, ...next }));
  }

  /** Re-runs the search with the current filters if there is something to search for. */
  function applyFilters() {
    const form = formRef.current;
    const input = form?.elements.namedItem("q");
    if (form && input instanceof HTMLInputElement && isSearchable(input.value)) {
      form.requestSubmit();
    }
  }

  return (
    <>
      <form
        ref={formRef}
        action="/search"
        role="search"
        aria-label="Search VerifyMzansi"
        className="mt-3 max-w-5xl sm:mt-5"
        onSubmit={() => setSubmitting(true)}
      >
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-0 lg:rounded-full lg:border lg:border-border lg:bg-card lg:p-1.5 lg:shadow-lg lg:shadow-black/10 lg:focus-within:ring-4 lg:focus-within:ring-brand-gold-300/30">
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1.5 shadow-lg shadow-black/10 focus-within:ring-4 focus-within:ring-brand-gold-300/30 lg:contents">
            <div className="relative min-w-0 flex-1 lg:order-1">
              <label htmlFor="site-search" className="sr-only">
                Search the website
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground lg:left-4"
              />
              <input
                ref={inputRef}
                id="site-search"
                type="search"
                name="q"
                defaultValue={query}
                maxLength={100}
                required
                autoComplete="off"
                enterKeyHint="search"
                placeholder="What are you looking for?"
                className="h-11 w-full rounded-full bg-transparent pl-10 pr-2 text-base text-foreground placeholder:text-muted-foreground/80 focus:outline-none lg:h-12 lg:pl-12 lg:text-[17px] [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
            <Button
              type="submit"
              variant="trust-verified"
              className="h-11 shrink-0 rounded-full px-5 lg:order-3 lg:ml-1.5 lg:h-12 lg:px-7"
              aria-busy={submitting || undefined}
            >
              {submitting ? (
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:hidden" />
              ) : null}
              Search
            </Button>
          </div>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0 lg:order-2 lg:gap-0 lg:overflow-visible">
            <FilterSelect
              id="site-search-province"
              name="province"
              label="Province"
              icon={MapPin}
              value={selectedProvince}
              onChange={(value) => changeFilters({ province: value, city: "" })}
              onApply={applyFilters}
            >
              <option value="">All provinces</option>
              {getProvinceNames().map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </FilterSelect>
            {townOptions.length > 0 ? (
              <FilterSelect
                id="site-search-city"
                name="city"
                label="Town or city"
                value={selectedCity}
                onChange={(value) => changeFilters({ city: value })}
                onApply={applyFilters}
              >
                <option value="">Any town</option>
                {townOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </FilterSelect>
            ) : null}
            {organisations.length > 0 || selectedOrg ? (
              <FilterSelect
                id="site-search-org"
                name="org"
                label="Business Sponsor"
                icon={BadgeCheck}
                value={selectedOrg}
                onChange={(value) => changeFilters({ org: value })}
                onApply={applyFilters}
              >
                <option value="">Any sponsor</option>
                {selectedOrg && !selectedOrgListed ? (
                  <option value={selectedOrg}>{humanizeSlug(selectedOrg)}</option>
                ) : null}
                {organisations.map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.name}
                  </option>
                ))}
              </FilterSelect>
            ) : null}
          </div>
        </div>
      </form>

      {showPopular ? (
        <div className="-mx-4 mt-2.5 flex items-center gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:mt-3.5 sm:flex-wrap sm:px-0">
          <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-white/60">
            Popular
          </h2>
          <ul className="flex gap-2 sm:flex-wrap">
            {POPULAR_SEARCHES.map((term) => (
              <li key={term} className="shrink-0">
                <Link
                  href={searchHref({ q: term, ...filters })}
                  prefetch={false}
                  className="inline-flex min-h-9 items-center rounded-full border border-white/15 bg-white/10 px-3.5 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 [@media(pointer:coarse)]:min-h-11"
                >
                  {term}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
