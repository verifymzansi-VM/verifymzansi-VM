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
    builder = builder.eq("category", filters.category) as T & MarketQueryOps;
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
    }
  }

  switch (filters.sort) {
    case "price_asc":
      return builder
        .order("price_cents", { ascending: true })
        .order("created_at", { ascending: false }) as T;
    case "price_desc":
      return builder
        .order("price_cents", { ascending: false })
        .order("created_at", { ascending: false }) as T;
    case "popular":
      return builder
        .order("featured", { ascending: false })
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false }) as T;
    case "newest":
    default:
      return builder
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false }) as T;
  }
}

export function matchesAttributeFilter(
  attributeValue: unknown,
  filterValue: string | boolean | string[]
) {
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

export function normalizeListingSelectShape(
  listings: Record<string, unknown>[]
): Record<string, unknown>[] {
  return listings.map((listing) => ({
    ...listing,
    featured_until: listing.featured_until ?? null,
    condition: listing.condition ?? null,
    video_thumbnail: listing.video_thumbnail ?? null,
    logo_url: listing.logo_url ?? null,
    view_count: listing.view_count ?? null,
  }));
}
