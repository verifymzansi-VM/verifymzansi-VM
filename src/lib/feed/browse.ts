import {
  BUSINESS_CATEGORIES,
  CATEGORIES,
  EVENT_TYPES,
  TOURISM_SUBCATEGORIES,
} from "@/lib/constants/categories";
import { LISTING_CONDITIONS } from "@/lib/constants/listing-condition";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import type { FeedVertical } from "@/lib/feed/types";

/**
 * What the viewer's top bar can browse without leaving the page: a section,
 * one province or the whole country, and that section's own filters.
 * Everything here is validated against the site's real option lists.
 */
export type BrowseSort = "recommended" | "newest" | "price_asc" | "price_desc";
export type TourismKind = "all" | "stays" | "events";

export interface FeedBrowse {
  vertical: FeedVertical;
  /** One province only, or null for the whole country (local posts first). */
  province: string | null;
  /** Market listing category, business category, or tourism stay type. */
  category: string | null;
  /** Market only. */
  condition: string | null;
  /** Tourism only: stays and places, events, or both. */
  kind: TourismKind;
  /** Tourism events only. */
  eventType: string | null;
  sort: BrowseSort;
  /** Words to find in the title or description. */
  query: string | null;
}

export interface BrowseOption {
  value: string;
  label: string;
}

const MARKET_SORTS: BrowseOption[] = [
  { value: "recommended", label: "Recommended" },
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];
const DEFAULT_SORTS: BrowseOption[] = MARKET_SORTS.slice(0, 2);

export function browseOptions(vertical: FeedVertical) {
  if (vertical === "market") {
    return {
      categories: CATEGORIES.map(({ value, label }) => ({ value, label })),
      conditions: LISTING_CONDITIONS.map(({ value, label }) => ({ value, label })),
      sorts: MARKET_SORTS,
    };
  }
  if (vertical === "business") {
    return {
      categories: BUSINESS_CATEGORIES.filter((item) => item.value !== "tourism_hospitality").map(
        ({ value, label }) => ({ value, label })
      ),
      conditions: [] as BrowseOption[],
      sorts: DEFAULT_SORTS,
    };
  }
  return {
    categories: TOURISM_SUBCATEGORIES.map(({ value, label }) => ({ value, label })),
    conditions: [] as BrowseOption[],
    sorts: DEFAULT_SORTS,
  };
}

export const EVENT_TYPE_OPTIONS: BrowseOption[] = EVENT_TYPES.map(({ value, label }) => ({
  value,
  label,
}));

export const VERTICAL_LABELS: Record<FeedVertical, string> = {
  market: "Mzansi Market",
  business: "Mzansi Business",
  tourism: "Tourism & Events",
};

export function defaultBrowse(vertical: FeedVertical, province: string | null = null): FeedBrowse {
  return {
    vertical,
    province,
    category: null,
    condition: null,
    kind: "all",
    eventType: null,
    sort: "recommended",
    query: null,
  };
}

/** Letters, numbers and spaces only (the same rule as the list pages' search), at most 60. */
export function cleanBrowseQuery(value: string | null | undefined): string | null {
  const cleaned = (value ?? "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 60) : null;
}

/** How many filters are set beyond the section and province (for the badge). */
export function activeFilterCount(browse: FeedBrowse) {
  return [
    browse.category,
    browse.condition,
    browse.vertical === "tourism" && browse.kind !== "all" ? browse.kind : null,
    browse.eventType,
    browse.sort !== "recommended" ? browse.sort : null,
    browse.query,
  ].filter(Boolean).length;
}

const has = (options: BrowseOption[], value: string | null) =>
  value != null && options.some((option) => option.value === value);

/** Reads `?v=&province=&category=…`; anything not on the real option lists is refused. */
export function parseBrowse(params: URLSearchParams): FeedBrowse | null {
  const vertical = params.get("v");
  if (vertical !== "market" && vertical !== "business" && vertical !== "tourism") return null;
  const options = browseOptions(vertical);
  const province = params.get("province");
  if (province && !getProvinceNames().includes(province)) return null;
  const category = params.get("category");
  if (category && !has(options.categories, category)) return null;
  const condition = params.get("condition");
  if (condition && (vertical !== "market" || !has(options.conditions, condition))) return null;
  const kind = (params.get("kind") ?? "all") as TourismKind;
  if (!["all", "stays", "events"].includes(kind) || (kind !== "all" && vertical !== "tourism")) {
    return null;
  }
  const eventType = params.get("eventType");
  if (eventType && (vertical !== "tourism" || !has(EVENT_TYPE_OPTIONS, eventType))) return null;
  const sort = (params.get("sort") ?? "recommended") as BrowseSort;
  if (!has(options.sorts, sort)) return null;
  return {
    vertical,
    province: province || null,
    category: category || null,
    condition: condition || null,
    kind,
    eventType: eventType || null,
    sort,
    query: cleanBrowseQuery(params.get("q")),
  };
}

export function serializeBrowse(browse: FeedBrowse): string {
  const params = new URLSearchParams({ v: browse.vertical });
  if (browse.province) params.set("province", browse.province);
  if (browse.category) params.set("category", browse.category);
  if (browse.condition) params.set("condition", browse.condition);
  if (browse.kind !== "all") params.set("kind", browse.kind);
  if (browse.eventType) params.set("eventType", browse.eventType);
  if (browse.sort !== "recommended") params.set("sort", browse.sort);
  if (browse.query) params.set("q", browse.query);
  return params.toString();
}

/** "Vehicles in Gauteng", "Events in all of South Africa": used in empty and end states. */
export function describeBrowse(browse: FeedBrowse): string {
  const options = browseOptions(browse.vertical);
  const what =
    options.categories.find((option) => option.value === browse.category)?.label ??
    (browse.vertical === "tourism" && browse.kind === "events"
      ? (EVENT_TYPE_OPTIONS.find((option) => option.value === browse.eventType)?.label ?? "Events")
      : browse.vertical === "tourism" && browse.kind === "stays"
        ? "Stays and places"
        : VERTICAL_LABELS[browse.vertical]);
  const where = browse.province ?? "all of South Africa";
  return browse.query ? `“${browse.query}” in ${what}, ${where}` : `${what} in ${where}`;
}
