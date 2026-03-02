import type { ListingCategory } from "@/types/enums";

type SearchParamsLike = Pick<URLSearchParams, "get">;

const VALID_LISTING_CATEGORIES = new Set<ListingCategory>([
  "property",
  "vehicles",
  "auto_parts",
  "electronics",
  "home_lifestyle",
  "jobs_services",
]);

const LEGACY_CATEGORY_ALIASES: Record<string, ListingCategory> = {
  cars: "vehicles",
  jobs: "jobs_services",
};

function normalizeParamValue(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeMarketplaceCategoryParam(
  category: string | null | undefined
): ListingCategory | undefined {
  const normalized = normalizeParamValue(category)?.toLowerCase();
  if (!normalized) return undefined;

  const canonical = LEGACY_CATEGORY_ALIASES[normalized] ?? normalized;
  return VALID_LISTING_CATEGORIES.has(canonical as ListingCategory)
    ? (canonical as ListingCategory)
    : undefined;
}

export function normalizeMarketplaceQueryParam(
  query: string | null | undefined
): string | undefined {
  return normalizeParamValue(query);
}

export interface MarketplaceFiltersFromParams {
  category?: ListingCategory;
  query?: string;
}

export function parseMarketplaceFiltersFromSearchParams(
  searchParams: SearchParamsLike
): MarketplaceFiltersFromParams {
  return {
    category: normalizeMarketplaceCategoryParam(searchParams.get("category")),
    query: normalizeMarketplaceQueryParam(searchParams.get("q")),
  };
}
