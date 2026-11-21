"use client";

import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Play, Search } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getListingCategoryLabel } from "@/lib/presentation/listing-facts";
import {
  STOREFRONT_PAGE_SIZE,
  stockCount,
  storefrontCard,
  storefrontTrade,
  type StorefrontCardData,
  type StorefrontSummary,
} from "@/lib/presentation/storefront";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { formatRandAmount } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const MAX_PRICES = [5000, 10000, 20000, 50000, 100000, 200000, 300000, 500000, 1000000, 2000000];
const BEDROOMS = ["1", "2", "3", "4", "5"];

interface Filters {
  q: string;
  sort: string;
  make: string;
  maxPrice: string;
  minYear: string;
  gearbox: string;
  intent: string;
  area: string;
  minBeds: string;
  category: string;
}
const NO_FILTERS: Filters = {
  q: "",
  sort: "newest",
  make: "",
  maxPrice: "",
  minYear: "",
  gearbox: "",
  intent: "",
  area: "",
  minBeds: "",
  category: "",
};

/** The /api/listings query for a page of the storefront with these filters. */
function stockQuery(businessId: string, filters: Filters, page: number) {
  const params = new URLSearchParams({
    storefront: businessId,
    limit: String(STOREFRONT_PAGE_SIZE),
    page: String(page),
    sort: filters.sort,
  });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.make) params.set("make", filters.make);
  if (filters.maxPrice) params.set("maxPrice", filters.maxPrice);
  if (filters.minYear || filters.gearbox) params.set("category", "vehicles");
  if (filters.minYear) params.set("attr_year_min", filters.minYear);
  if (filters.gearbox) params.set("attr_transmission", filters.gearbox);
  if (filters.intent || filters.minBeds) params.set("category", "property");
  if (filters.intent) params.set("attr_listing_intent", filters.intent);
  if (filters.minBeds) params.set("attr_bedrooms_min", filters.minBeds);
  if (filters.area) {
    const [province, city] = filters.area.split(":");
    params.set("province", province!);
    params.set("city", city!);
  }
  if (filters.category) params.set("category", filters.category);
  return params;
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-10 appearance-none rounded-full border bg-background py-0 pl-4 pr-9 text-sm font-medium text-foreground transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value ? "border-brand-green-600" : "border-input"
        )}
      >
        <option value="">{label}</option>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
    </label>
  );
}

function StorefrontCard({ card }: { card: StorefrontCardData }) {
  return (
    <Link
      href={`/listing/${card.id}`}
      className="group overflow-hidden rounded-2xl border bg-card transition-colors hover:border-brand-green/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-[4/5] bg-muted">
        {card.image ? (
          <Image
            src={normalizeMediaUrl(card.image)}
            alt=""
            fill
            sizes="(max-width: 1024px) 50vw, 300px"
            className="object-contain"
          />
        ) : null}
        {card.hasVideo ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
            <Play aria-hidden="true" className="h-3 w-3" />
            Video
          </span>
        ) : null}
      </div>
      <div className="space-y-0.5 p-3">
        <h3 className="truncate font-sans text-sm font-medium text-foreground">{card.title}</h3>
        <p className="text-sm font-semibold text-brand-green-700 dark:text-brand-gold-300">
          {card.price}
        </p>
        {card.facts ? <p className="text-xs text-muted-foreground">{card.facts}</p> : null}
      </div>
    </Link>
  );
}

/**
 * "All stock" on a business page (business tools plan section 1, item 17b):
 * the live Market listings of the business's Multi-listing package, newest
 * first, with a search, filters that follow the trade, a sort and "Show more".
 * The first page comes from the server; later pages and filters are read from
 * /api/listings with the storefront filter.
 */
export function BusinessStorefront({
  storefront,
  areaLabels,
  initial,
}: {
  storefront: StorefrontSummary;
  /** "province:city" → place name, for the property Area filter. */
  areaLabels: Record<string, string>;
  initial: { cards: StorefrontCardData[]; total: number };
}) {
  const trade = storefrontTrade(storefront.categories);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState(initial.cards);
  const [total, setTotal] = useState(initial.total);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const request = useRef(0);
  const thisYear = new Date().getFullYear();

  async function load(next: Filters, nextPage: number) {
    const id = ++request.current;
    setState("loading");
    try {
      const response = await fetch(
        `/api/listings?${stockQuery(storefront.businessId, next, nextPage)}`,
        { cache: "no-store" }
      );
      if (!response.ok) throw new Error("Stock could not be loaded");
      const body = (await response.json()) as {
        listings: Parameters<typeof storefrontCard>[1][];
        total: number;
      };
      if (id !== request.current) return;
      const loaded = body.listings.map((row) => storefrontCard(trade, row));
      setCards((current) => (nextPage === 1 ? loaded : [...current, ...loaded]));
      setTotal(body.total);
      setPage(nextPage);
      setState("idle");
    } catch {
      if (id === request.current) setState("error");
    }
  }

  function change(patch: Partial<Filters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next, 1);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    change({ q: query });
  }

  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  // "Sample Motors' cars", "Thandi's Homes' properties", "Zola's stock".
  const owned = `${storefront.businessName}${/s$/i.test(storefront.businessName) ? "'" : "'s"}`;
  const categories = Object.keys(storefront.categories).sort((a, b) =>
    (getListingCategoryLabel(a) ?? a).localeCompare(getListingCategoryLabel(b) ?? b)
  );

  return (
    <section id="stock" aria-labelledby="stock-heading" className="scroll-mt-24 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="stock-heading" className="font-display text-2xl font-semibold tracking-tight">
          All stock{" "}
          <span className="font-sans text-base font-normal text-muted-foreground">
            {stockCount(trade, storefront.listings)}
          </span>
        </h2>
        <FilterSelect
          label="Newest first"
          value={filters.sort === "newest" ? "" : filters.sort}
          onChange={(value) => change({ sort: value || "newest" })}
        >
          <option value="price_asc">Lowest price</option>
          <option value="price_desc">Highest price</option>
        </FilterSelect>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form role="search" onSubmit={search} className="relative lg:w-[28rem] lg:shrink-0">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
            onBlur={() => query !== filters.q && change({ q: query })}
            placeholder={`Search ${owned} ${trade === "vehicles" ? "cars" : trade === "property" ? "properties" : "stock"}`}
            aria-label={`Search ${owned} stock`}
            className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0 lg:pb-0">
          {trade === "vehicles" ? (
            <>
              <FilterSelect label="Make" value={filters.make} onChange={(make) => change({ make })}>
                {storefront.makes.map((make) => (
                  <option key={make} value={make}>
                    {make}
                  </option>
                ))}
              </FilterSelect>
              <PriceFilter value={filters.maxPrice} onChange={(maxPrice) => change({ maxPrice })} />
              <FilterSelect
                label="Year"
                value={filters.minYear}
                onChange={(minYear) => change({ minYear })}
              >
                {[1, 3, 5, 8, 10, 15].map((back) => (
                  <option key={back} value={String(thisYear - back)}>
                    {thisYear - back} or newer
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Gearbox"
                value={filters.gearbox}
                onChange={(gearbox) => change({ gearbox })}
              >
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
              </FilterSelect>
            </>
          ) : trade === "property" ? (
            <>
              <FilterSelect
                label="For sale or to rent"
                value={filters.intent}
                onChange={(intent) => change({ intent })}
              >
                <option value="sale">For sale</option>
                <option value="rent">To rent</option>
              </FilterSelect>
              <FilterSelect label="Area" value={filters.area} onChange={(area) => change({ area })}>
                {storefront.areas.map(({ province, city }) => (
                  <option key={city} value={`${province}:${city}`}>
                    {areaLabels[`${province}:${city}`] ?? city}
                  </option>
                ))}
              </FilterSelect>
              <PriceFilter value={filters.maxPrice} onChange={(maxPrice) => change({ maxPrice })} />
              <FilterSelect
                label="Bedrooms"
                value={filters.minBeds}
                onChange={(minBeds) => change({ minBeds })}
              >
                {BEDROOMS.map((beds) => (
                  <option key={beds} value={beds}>
                    {beds}+ bedrooms
                  </option>
                ))}
              </FilterSelect>
            </>
          ) : (
            <>
              <FilterSelect
                label="Category"
                value={filters.category}
                onChange={(category) => change({ category })}
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {getListingCategoryLabel(category) ?? category}
                  </option>
                ))}
              </FilterSelect>
              <PriceFilter value={filters.maxPrice} onChange={(maxPrice) => change({ maxPrice })} />
            </>
          )}
        </div>
      </div>

      {state === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          Stock could not be loaded. Please try again.
        </p>
      ) : null}

      {cards.length > 0 ? (
        <div
          aria-busy={state === "loading"}
          className={cn(
            "grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4",
            state === "loading" && "opacity-60"
          )}
        >
          {cards.map((card) => (
            <StorefrontCard key={card.id} card={card} />
          ))}
        </div>
      ) : state !== "loading" ? (
        <div className="space-y-3 rounded-2xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
          {filtered ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setQuery("");
                change(NO_FILTERS);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      {cards.length < total ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="rounded-full px-6"
            disabled={state === "loading"}
            onClick={() => void load(filters, page + 1)}
          >
            Show more
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PriceFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <FilterSelect label="Price" value={value} onChange={onChange}>
      {MAX_PRICES.map((amount) => (
        <option key={amount} value={String(amount)}>
          Up to R{formatRandAmount(amount)}
        </option>
      ))}
    </FilterSelect>
  );
}
