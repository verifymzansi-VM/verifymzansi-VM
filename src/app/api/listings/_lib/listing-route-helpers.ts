import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import type { parseMarketplaceFiltersFromSearchParams } from "@/lib/utils/marketplace-query";
import { withOwnerColumn, type OwnerColumn } from "@/lib/account/compat";

export const LISTING_SELECT_FALLBACK_FIELDS = [
  "featured_until",
  "condition",
  "video_thumbnail",
  "logo_url",
  "view_count",
] as const;

export type ListingInsertErrorLike = {
  code?: string | null;
  message?: string | null;
} | null;

export type ListingCompatField =
  | "location_address"
  | "location_suburb"
  | "logo_url"
  | "media_height"
  | "media_width"
  | "focal_x"
  | "focal_y"
  | "video_thumbnail";

export const LISTING_INSERT_COMPAT_FIELDS: readonly ListingCompatField[] = [
  "location_address",
  "location_suburb",
  "logo_url",
  "media_height",
  "media_width",
  "focal_x",
  "focal_y",
  "video_thumbnail",
];

export function createListingSelectAttempts(ownerColumn: OwnerColumn) {
  return [
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured, view_count, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: [] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured, view_count, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["featured_until"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured, view_count, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["condition"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured, view_count, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["video_thumbnail"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, location_province, location_city, created_at, boost_until, featured_until, featured, view_count, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["logo_url"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["view_count"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["featured_until", "view_count"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, attributes, photos, videos, video_thumbnail, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["condition", "view_count"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, logo_url, location_province, location_city, created_at, boost_until, featured_until, featured, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: ["video_thumbnail", "view_count"] as const,
    },
    {
      select: withOwnerColumn(
        "id, owner_id, title, description, price_cents, price_negotiable, category, attributes, photos, videos, location_province, location_city, created_at, boost_until, featured, media_width, media_height, focal_x, focal_y",
        ownerColumn
      ),
      omittedFields: [
        "featured_until",
        "condition",
        "video_thumbnail",
        "logo_url",
        "view_count",
      ] as const,
    },
  ] as const;
}

type MarketQueryOps = {
  eq: (column: string, value: unknown) => MarketQueryOps;
  gte: (column: string, value: number) => MarketQueryOps;
  lte: (column: string, value: number) => MarketQueryOps;
  or: (filters: string) => MarketQueryOps;
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ) => MarketQueryOps;
};

export function canRetryListingInsertForCompat(
  error: ListingInsertErrorLike,
  omittedFields: readonly ListingCompatField[]
) {
  if (!error) return false;

  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (/schema cache/.test(message)) {
    return true;
  }

  const retryableCodes = new Set(["42703", "PGRST200", "PGRST202", "PGRST204", "XX000"]);

  if (!retryableCodes.has(code) && !/does not exist|could not find/.test(message)) {
    return false;
  }

  return omittedFields.some((field) => message.includes(field.toLowerCase()));
}

export function omitListingCompatFields<T extends Record<string, unknown>>(
  record: T,
  omittedFields: readonly ListingCompatField[]
) {
  const next = { ...record };
  for (const field of omittedFields) {
    delete next[field];
  }
  return next;
}

export function applyBaseMarketFilters<T>(
  query: T,
  filters: ReturnType<typeof parseMarketplaceFiltersFromSearchParams>
): T {
  let builder = query as T & MarketQueryOps;

  if (filters.category) {
    // Older Home & Lifestyle links included these item groups.
    builder = (
      filters.category === "home_lifestyle"
        ? builder.or(
            "category.eq.home_lifestyle,category.eq.clothing_accessories,category.eq.sports_hobbies,category.eq.other_items"
          )
        : builder.eq("category", filters.category)
    ) as T & MarketQueryOps;
  }
  if (filters.province) {
    builder = builder.eq("location_province", filters.province) as T & MarketQueryOps;
  }
  if (filters.city) {
    builder = builder.eq("location_city", filters.city) as T & MarketQueryOps;
  }
  if (filters.priceMin !== undefined) {
    builder = builder.gte("price_cents", Math.round(filters.priceMin * 100)) as T & MarketQueryOps;
  }
  if (filters.priceMax !== undefined) {
    builder = builder.lte("price_cents", Math.round(filters.priceMax * 100)) as T & MarketQueryOps;
  }
  if (filters.condition) {
    builder = builder.eq("condition", filters.condition) as T & MarketQueryOps;
  }
  if (filters.query) {
    const safeSearch = filters.query.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
    if (safeSearch) {
      builder = builder.or(`title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`) as T &
        MarketQueryOps;
    } else {
      // The search token sanitized to nothing (e.g. "!!!") — force an empty
      // result so it matches the active filter chip instead of silently
      // returning the unfiltered page.
      builder = builder.eq("id", "00000000-0000-0000-0000-000000000000") as T & MarketQueryOps;
    }
  }

  switch (filters.sort) {
    case "price_asc":
      return builder
        .order("price_cents", { ascending: true })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }) as T;
    case "price_desc":
      return builder
        .order("price_cents", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }) as T;
    case "popular":
      return builder
        .order("view_count", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }) as T;
    case "newest":
      // The id tie-break keeps equal timestamps in one order across pages.
      return builder
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }) as T;
    case "recommended":
    default:
      // Everyone pays the same, so the default order is a fair rotation:
      // posts from the last 72 hours first, then a shuffle that changes every
      // 6 hours (fair_rotation_key, 20261002135904). Stable across pages.
      return builder
        .order("fair_rotation_key", { ascending: true })
        .order("id", { ascending: true }) as T;
  }
}

function matchesAttributeFilter(attributeValue: unknown, filterValue: string | boolean | string[]) {
  if (Array.isArray(filterValue)) {
    if (!Array.isArray(attributeValue)) {
      return false;
    }

    const normalizedAttributeValues = attributeValue.map((value) => String(value).toLowerCase());
    return filterValue.some((value) => normalizedAttributeValues.includes(value.toLowerCase()));
  }

  if (typeof filterValue === "boolean") {
    return attributeValue === filterValue;
  }

  if (attributeValue === null || attributeValue === undefined) {
    return false;
  }

  if (typeof attributeValue === "number") {
    if (filterValue.endsWith("+")) {
      const minimum = Number(filterValue.slice(0, -1));
      return Number.isFinite(minimum) && attributeValue >= minimum;
    }

    const parsed = Number(filterValue);
    return Number.isFinite(parsed) ? attributeValue === parsed : false;
  }

  if (typeof attributeValue === "boolean") {
    return String(attributeValue) === filterValue;
  }

  if (Array.isArray(attributeValue)) {
    return attributeValue.some(
      (value) => String(value).toLowerCase() === filterValue.toLowerCase()
    );
  }

  return String(attributeValue).toLowerCase().includes(filterValue.toLowerCase());
}

export function matchesAttributeFilters(
  attributes: Record<string, unknown> | null | undefined,
  filters: Record<string, string | boolean | string[]>
) {
  return Object.entries(filters).every(([key, value]) =>
    matchesAttributeFilter(attributes?.[key], value)
  );
}

export function isPlaceholderListing(listing: {
  title: string | null;
  description?: string | null;
}) {
  return isPlaceholderMarketplaceContent(listing.title, listing.description);
}

function isActiveUntil(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  const until = Date.parse(value);
  return Number.isFinite(until) && until > Date.now();
}

export function normalizeListingSelectShape(
  listings: Record<string, unknown>[]
): Record<string, unknown>[] {
  return listings.map((listing) => ({
    ...listing,
    // The stored `featured` flag is only recomputed when featured_until is
    // written, so it stays true after the paid window ends.
    featured:
      "featured_until" in listing ? isActiveUntil(listing.featured_until) : listing.featured,
    featured_until: listing.featured_until ?? null,
    condition: listing.condition ?? null,
    video_thumbnail: listing.video_thumbnail ?? null,
    logo_url: listing.logo_url ?? null,
    view_count: listing.view_count ?? null,
  }));
}
