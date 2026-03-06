import type {
  BusinessCategory,
  BusinessType,
  ListingCategory,
  ListingCondition,
} from "@/types/enums";

type SearchParamsLike = Pick<URLSearchParams, "get" | "forEach">;

const VALID_LISTING_CATEGORIES = new Set<ListingCategory>([
  "property",
  "vehicles",
  "auto_parts",
  "electronics",
  "home_lifestyle",
  "jobs_services",
]);

const VALID_LISTING_CONDITIONS = new Set<ListingCondition>([
  "new",
  "like_new",
  "good",
  "fair",
  "for_parts",
]);

const VALID_BUSINESS_CATEGORIES = new Set<BusinessCategory>([
  "fashion_accessories",
  "electronics_tech",
  "groceries_essentials",
  "health_beauty",
  "home_living",
  "food_dining",
  "trade_maintenance",
  "professional_services",
  "education_training",
  "events_entertainment",
  "automotive_transport",
  "general_other",
]);

const VALID_BUSINESS_TYPES = new Set<BusinessType>([
  "mall_store",
  "standalone_shop",
  "home_business",
  "mobile_service",
  "online_only",
  "market_stall",
]);

const VALID_MARKET_SORTS = new Set(["newest", "price_asc", "price_desc", "popular"] as const);
type MarketSort = "newest" | "price_asc" | "price_desc" | "popular";

const LEGACY_CATEGORY_ALIASES: Record<string, ListingCategory> = {
  cars: "vehicles",
  jobs: "jobs_services",
};

function normalizeParamValue(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIntegerParam(value: string | null | undefined): number | undefined {
  const normalized = normalizeParamValue(value);
  if (!normalized) return undefined;

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeNumberParam(value: string | null | undefined): number | undefined {
  const normalized = normalizeParamValue(value);
  if (!normalized) return undefined;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
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

export function normalizeMarketplaceConditionParam(
  condition: string | null | undefined
): ListingCondition | undefined {
  const normalized = normalizeParamValue(condition)?.toLowerCase();
  if (!normalized) return undefined;

  return VALID_LISTING_CONDITIONS.has(normalized as ListingCondition)
    ? (normalized as ListingCondition)
    : undefined;
}

export function normalizeMarketplaceQueryParam(
  query: string | null | undefined
): string | undefined {
  return normalizeParamValue(query);
}

export function normalizeBusinessCategoryParam(
  category: string | null | undefined
): BusinessCategory | undefined {
  const normalized = normalizeParamValue(category)?.toLowerCase();
  if (!normalized) return undefined;

  return VALID_BUSINESS_CATEGORIES.has(normalized as BusinessCategory)
    ? (normalized as BusinessCategory)
    : undefined;
}

export function normalizeBusinessTypeParam(
  type: string | null | undefined
): BusinessType | undefined {
  const normalized = normalizeParamValue(type)?.toLowerCase();
  if (!normalized) return undefined;

  return VALID_BUSINESS_TYPES.has(normalized as BusinessType)
    ? (normalized as BusinessType)
    : undefined;
}

export interface MarketFiltersFromParams {
  category?: ListingCategory;
  query?: string;
  province?: string;
  city?: string;
  condition?: ListingCondition;
  sort?: MarketSort;
  priceMin?: number;
  priceMax?: number;
  page: number;
  attributes: Record<string, string | boolean>;
}

export interface BusinessFiltersFromParams {
  query?: string;
  businessCategory?: BusinessCategory;
  businessType?: BusinessType;
  province?: string;
  city?: string;
  mall?: string;
  page: number;
}

export function parseMarketplaceFiltersFromSearchParams(
  searchParams: SearchParamsLike
): MarketFiltersFromParams {
  const attributes: Record<string, string | boolean> = {};

  searchParams.forEach((rawValue, key) => {
    if (!key.startsWith("attr_")) return;

    const value = normalizeParamValue(rawValue);
    if (!value) return;

    attributes[key.slice(5)] =
      value === "true" ? true : value === "false" ? false : value;
  });

  const sort = normalizeParamValue(searchParams.get("sort"));

  return {
    category: normalizeMarketplaceCategoryParam(searchParams.get("category")),
    query: normalizeMarketplaceQueryParam(searchParams.get("q")),
    province: normalizeParamValue(searchParams.get("province")),
    city: normalizeParamValue(searchParams.get("city")),
    condition: normalizeMarketplaceConditionParam(searchParams.get("condition")),
    sort: VALID_MARKET_SORTS.has(sort as MarketSort)
      ? (sort as MarketSort)
      : undefined,
    priceMin: normalizeNumberParam(searchParams.get("minPrice")),
    priceMax: normalizeNumberParam(searchParams.get("maxPrice")),
    page: normalizeIntegerParam(searchParams.get("page")) ?? 1,
    attributes,
  };
}

export function parseBusinessFiltersFromSearchParams(
  searchParams: SearchParamsLike
): BusinessFiltersFromParams {
  return {
    query: normalizeMarketplaceQueryParam(searchParams.get("q")),
    businessCategory: normalizeBusinessCategoryParam(searchParams.get("category")),
    businessType: normalizeBusinessTypeParam(searchParams.get("type")),
    province: normalizeParamValue(searchParams.get("province")),
    city: normalizeParamValue(searchParams.get("city")),
    mall: normalizeParamValue(searchParams.get("mall")),
    page: normalizeIntegerParam(searchParams.get("page")) ?? 1,
  };
}

export interface MarketFiltersForUrl {
  category?: string;
  query?: string;
  province?: string;
  city?: string;
  condition?: string;
  sort?: MarketSort;
  priceMin?: number;
  priceMax?: number;
  attributes?: Record<string, string | boolean | undefined>;
}

export interface BusinessFiltersForUrl {
  query?: string;
  businessCategory?: string;
  businessType?: string;
  province?: string;
  city?: string;
  mall?: string;
}

function appendIfPresent(params: URLSearchParams, key: string, value: string | number | undefined) {
  if (value === undefined || value === "") return;
  params.set(key, String(value));
}

export function serializeMarketplaceFiltersToSearchParams(
  filters: MarketFiltersForUrl,
  page = 1
): URLSearchParams {
  const params = new URLSearchParams();

  appendIfPresent(params, "q", filters.query);
  appendIfPresent(params, "category", filters.category);
  appendIfPresent(params, "province", filters.province);
  appendIfPresent(params, "city", filters.city);
  appendIfPresent(params, "condition", filters.condition);
  if (filters.sort && filters.sort !== "newest") {
    params.set("sort", filters.sort);
  }
  appendIfPresent(params, "minPrice", filters.priceMin);
  appendIfPresent(params, "maxPrice", filters.priceMax);

  for (const [key, value] of Object.entries(filters.attributes ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (value === undefined || value === "") continue;
    params.set(`attr_${key}`, String(value));
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  return params;
}

export function serializeBusinessFiltersToSearchParams(
  filters: BusinessFiltersForUrl,
  page = 1
): URLSearchParams {
  const params = new URLSearchParams();

  appendIfPresent(params, "q", filters.query);
  appendIfPresent(params, "category", filters.businessCategory);
  appendIfPresent(params, "type", filters.businessType);
  appendIfPresent(params, "province", filters.province);
  appendIfPresent(params, "city", filters.city);
  appendIfPresent(params, "mall", filters.mall);

  if (page > 1) {
    params.set("page", String(page));
  }

  return params;
}
