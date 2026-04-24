import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listingSchema } from "@/lib/validations/listing";
import { logAuditEvent } from "@/lib/services/audit";
import { getEntitlements, canCreateListing } from "@/lib/services/entitlements";
import { checkLocalRateLimit, checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { parseJsonRequest, parseAndValidateSearchParams } from "@/lib/utils/api";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { isPostingLimitBypassEnabled } from "../../../lib/utils/posting-limit-bypass";
import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecords,
  type OwnerColumn,
  readAccountVerificationStatus,
  withOwnerColumn,
  withOwnerField,
} from "@/lib/account/compat";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";
import { hasPhoneNumber } from "@/lib/account/require-phone";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import {
  normalizeMarketplaceCategoryParam,
  normalizeMarketplaceConditionParam,
  parseMarketplaceFiltersFromSearchParams,
} from "@/lib/utils/marketplace-query";
import { createVerificationRequiredPayload, isVerifiedMember } from "@/app/post/_lib/post-access";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { queryWithSelectFallbacks } from "@/lib/utils/marketplace-select-fallback";
import {
  createBoundedIntegerSchema,
  createNonNegativeNumberSchema,
  optionalTrimmedStringSchema,
} from "@/lib/validations/shared";
import { z } from "zod";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import {
  createNotification,
  notifyStaffForAdminEvent,
  shouldSendOwnerLifecycleNotifications,
} from "@/lib/notifications";
import { claimFreePostSlot, releaseFreePostSlot } from "@/lib/billing/free-posts";
import { buildViewerKey, ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import { getContentLikeSummaryMap, getContentViewCountMap } from "@/lib/engagement-server";
import { confirmMediaUploads } from "@/lib/media/confirm-media-uploads";

const log = createLogger("ListingCreate");
const AREA: MarketplaceArea = "MZANSI_MARKET";
const LISTING_SELECT_FALLBACK_FIELDS = [
  "featured_until",
  "condition",
  "video_thumbnail",
  "logo_url",
  "view_count",
] as const;
const listingsQuerySchema = z.object({
  category: optionalTrimmedStringSchema,
  q: optionalTrimmedStringSchema,
  province: optionalTrimmedStringSchema,
  city: optionalTrimmedStringSchema,
  condition: optionalTrimmedStringSchema,
  sort: optionalTrimmedStringSchema,
  minPrice: createNonNegativeNumberSchema("minPrice"),
  maxPrice: createNonNegativeNumberSchema("maxPrice"),
  page: createBoundedIntegerSchema({ defaultValue: 1, min: 1, max: 10_000, fieldName: "page" }),
  limit: createBoundedIntegerSchema({ defaultValue: 24, min: 1, max: 50, fieldName: "limit" }),
});

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

type ListingInsertErrorLike = {
  code?: string | null;
  message?: string | null;
} | null;

type ListingCompatField =
  | "location_address"
  | "location_suburb"
  | "logo_url"
  | "media_height"
  | "media_width"
  | "focal_x"
  | "focal_y"
  | "video_thumbnail";

const LISTING_INSERT_COMPAT_FIELDS: readonly ListingCompatField[] = [
  "location_address",
  "location_suburb",
  "logo_url",
  "media_height",
  "media_width",
  "focal_x",
  "focal_y",
  "video_thumbnail",
];

function canRetryListingInsertForCompat(
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

function omitListingCompatFields<T extends Record<string, unknown>>(
  record: T,
  omittedFields: readonly ListingCompatField[]
) {
  const next = { ...record };
  for (const field of omittedFields) {
    delete next[field];
  }
  return next;
}

function applyBaseMarketFilters<T>(
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
    // Strip all characters that are special in PostgREST filter syntax or
    // Postgres LIKE patterns to prevent filter injection and query errors.
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

function matchesAttributeFilters(
  attributes: Record<string, unknown> | null | undefined,
  filters: Record<string, string | boolean | string[]>
) {
  return Object.entries(filters).every(([key, value]) =>
    matchesAttributeFilter(attributes?.[key], value)
  );
}

function isPlaceholderListing(listing: { title: string | null; description?: string | null }) {
  return isPlaceholderMarketplaceContent(listing.title, listing.description);
}

function normalizeListingSelectShape(
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

/**
 * GET /api/listings
 *
 * Public listing discovery endpoint for Mzansi Market with filtering and pagination.
 *
 * NOTE: Uses admin client (bypasses RLS) intentionally for public marketplace reads.
 * Security relies on explicit application-level filters (.eq("status", "live"),
 * .neq("status", "rejected"), etc.) rather than RLS policies. This allows efficient
 * queries with seller profile joins that would be restricted by user-scoped RLS.
 */
export async function GET(request: NextRequest) {
  try {
    const hideFixtures = shouldHidePlaywrightFixtures(
      request.cookies?.get?.(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
    );
    // Rate limit public marketplace queries to prevent scraping/DoS
    const ip = getClientIp(request);
    const rl = checkLocalRateLimit(ip, "listings:read", 120);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const viewerKey = buildViewerKey(
      request.cookies?.get?.(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null,
      user?.id ?? null
    );
    const parsedQuery = parseAndValidateSearchParams(
      request.nextUrl.searchParams,
      listingsQuerySchema,
      {
        validationErrorMessage: "Invalid listings query",
      }
    );
    if (!parsedQuery.success) {
      return parsedQuery.response;
    }

    const query = parsedQuery.data;
    if (query.category && !normalizeMarketplaceCategoryParam(query.category)) {
      return NextResponse.json({ error: "Invalid listing category" }, { status: 400 });
    }
    if (query.condition && !normalizeMarketplaceConditionParam(query.condition)) {
      return NextResponse.json({ error: "Invalid listing condition" }, { status: 400 });
    }
    if (query.sort && !["newest", "price_asc", "price_desc", "popular"].includes(query.sort)) {
      return NextResponse.json({ error: "Invalid listing sort" }, { status: 400 });
    }

    let ownerColumn: OwnerColumn;
    try {
      ownerColumn = await getOwnerColumn(admin, "listings");
    } catch (ownerColumnError) {
      log.warn("Listings owner-column probe failed", {
        error: ownerColumnError instanceof Error ? ownerColumnError.message : "Unknown error",
      });
      return NextResponse.json(
        {
          error: "Marketplace temporarily unavailable",
          detail: "Listing ownership metadata is unavailable. Please retry shortly.",
        },
        { status: 503 }
      );
    }

    const filters = parseMarketplaceFiltersFromSearchParams(request.nextUrl.searchParams);
    filters.page = query.page;
    const limit = query.limit;
    const offset = (filters.page - 1) * limit;
    const selectAttempts = [
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
    const hasAttributeFilters = Object.keys(filters.attributes).length > 0;

    let listings: Record<string, unknown>[] = [];
    let total = 0;
    const MAX_ATTRIBUTE_FILTER_ROWS = 10_000;
    if (hasAttributeFilters) {
      const batchSize = 500;
      let from = 0;

      while (true) {
        const batchResult = await queryWithSelectFallbacks({
          attempts: selectAttempts,
          fallbackFields: LISTING_SELECT_FALLBACK_FIELDS,
          runQuery: (selectClause) =>
            applyBaseMarketFilters(
              // SECURITY: admin client bypasses RLS for efficient JOINs.
              // These application-level status filters are the security boundary.
              admin.from("listings").select(selectClause).eq("status", "live").eq("area", AREA),
              filters
            ).range(from, from + batchSize - 1),
        });

        const { data, error } = batchResult;
        if (error) {
          if (error.code === "PGRST205") {
            log.warn("Listings schema cache unavailable", {
              code: error.code,
              message: error.message,
            });
            return NextResponse.json(
              {
                error: "Marketplace temporarily unavailable",
                detail:
                  "The marketplace database schema is not available yet. Please retry in a moment.",
              },
              { status: 503 }
            );
          }
          log.error("Failed to fetch listings", { error: error.message });
          return NextResponse.json({ error: "Failed to fetch listings" }, { status: 500 });
        }

        const batch = normalizeListingSelectShape(
          (data ?? []) as unknown as Record<string, unknown>[]
        );
        listings.push(...batch);

        if (batch.length < batchSize) {
          break;
        }

        from += batchSize;

        // Guard against unbounded memory growth on very large tables
        if (from >= MAX_ATTRIBUTE_FILTER_ROWS) {
          log.warn("Attribute filter batch cap reached", {
            cap: MAX_ATTRIBUTE_FILTER_ROWS,
            query: filters.query,
          });
          break;
        }
      }

      listings = listings.filter(
        (listing) =>
          !isPlaceholderListing({
            title: String(listing.title ?? ""),
            description: typeof listing.description === "string" ? listing.description : null,
          }) &&
          matchesAttributeFilters(
            (listing.attributes as Record<string, unknown> | null | undefined) ?? {},
            filters.attributes
          )
      );
      total = listings.length;
      listings = listings.slice(offset, offset + limit);
    } else {
      const result = await queryWithSelectFallbacks({
        attempts: selectAttempts,
        fallbackFields: LISTING_SELECT_FALLBACK_FIELDS,
        runQuery: (selectClause) =>
          applyBaseMarketFilters(
            // SECURITY: admin client bypasses RLS for efficient JOINs.
            // These application-level status filters are the security boundary.
            admin
              .from("listings")
              .select(selectClause, { count: "exact" })
              .eq("status", "live")
              .eq("area", AREA),
            filters
          ).range(offset, offset + limit - 1),
      });

      const { data, count, error } = result;
      if (error) {
        if (error.code === "PGRST205") {
          log.warn("Listings schema cache unavailable", {
            code: error.code,
            message: error.message,
          });
          return NextResponse.json(
            {
              error: "Marketplace temporarily unavailable",
              detail:
                "The marketplace database schema is not available yet. Please retry in a moment.",
            },
            { status: 503 }
          );
        }
        log.error("Failed to fetch listings", { error: error.message });
        return NextResponse.json({ error: "Failed to fetch listings" }, { status: 500 });
      }

      const filteredListings = normalizeListingSelectShape(
        (data ?? []) as unknown as Record<string, unknown>[]
      ).filter(
        (listing) =>
          !isPlaceholderListing({
            title: String(listing.title ?? ""),
            description: typeof listing.description === "string" ? listing.description : null,
          })
      );

      listings = filteredListings;
      total = Math.max(
        0,
        (count ?? filteredListings.length) - ((data?.length ?? 0) - filteredListings.length)
      );
    }

    const normalizedListings = normalizeOwnerRecords(listings);
    const publicListings = hideFixtures
      ? normalizedListings.filter(
          (listing) => !shouldHidePlaywrightFixtureRowWhenEnabled(listing, true)
        )
      : normalizedListings;
    total = Math.max(0, total - (normalizedListings.length - publicListings.length));
    listings = publicListings;

    const listingIds = listings
      .map((listing) => String(listing.id ?? ""))
      .filter((id): id is string => id.length > 0);
    const sellerIds = Array.from(
      new Set(listings.map((listing) => String(listing.owner_id)).filter(Boolean))
    );
    const [viewCountResult, likeSummaryResult] = await Promise.all([
      getContentViewCountMap(admin, "listing", listingIds),
      getContentLikeSummaryMap(admin, "listing", listingIds, viewerKey),
    ]);
    const engagementAvailable = viewCountResult.ok && likeSummaryResult.ok;
    if (!engagementAvailable) {
      log.error("Failed to load listing engagement summary", {
        listingIds,
        viewErrorCode: viewCountResult.errorCode,
        likeErrorCode: likeSummaryResult.errorCode,
      });
    }

    const { data: sellers } = sellerIds.length
      ? await admin
          .from("account_profiles")
          .select("user_id, display_name, account_verification_status")
          .in("user_id", sellerIds)
          .limit(sellerIds.length)
      : { data: [] as Array<Record<string, unknown>> };

    const serializedSellers =
      sellers?.map((seller) => ({
        user_id: seller.user_id,
        display_name: seller.display_name,
        account_verification_status: readAccountVerificationStatus(seller),
      })) ?? [];
    const serializedListings = listings.map((listing) => {
      const listingId = String(listing.id ?? "");
      const fallbackViewCount = engagementAvailable
        ? (viewCountResult.data.get(listingId) ?? null)
        : null;
      const likeSummary = engagementAvailable ? likeSummaryResult.data.get(listingId) : undefined;

      return {
        ...listing,
        view_count: typeof listing.view_count === "number" ? listing.view_count : fallbackViewCount,
        like_count: engagementAvailable ? (likeSummary?.likeCount ?? null) : null,
        viewer_has_liked: likeSummary?.viewerHasLiked ?? false,
      };
    });

    return NextResponse.json({
      listings: serializedListings,
      sellers: serializedSellers,
      engagement_available: engagementAvailable,
      total,
      page: filters.page,
      limit,
    });
  } catch (err) {
    log.error("Unexpected error in listing fetch", {
      error: err instanceof Error ? err.message : "unknown",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to fetch listings" }, { status: 500 });
  }
}

/**
 * POST /api/listings
 *
 * Server-side listing creation with full validation, auth, ownership,
 * entitlement enforcement, and free-post tracking.
 */
export async function POST(request: NextRequest) {
  try {
    // ── CSRF protection ───────────────────────────────────────
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Rate limit ───────────────────────────────────────────
    const ip = getClientIp(request);
    const rl = await checkRateLimit({
      key: user.id,
      action: "listing_create",
      deviceId: ip,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    let admin: ReturnType<typeof createAdminClient> | null = null;
    const getAdmin = () => {
      admin ??= createAdminClient();
      return admin;
    };
    let ownerColumn: OwnerColumn;
    try {
      ownerColumn = await getOwnerColumn(supabase, "listings");
    } catch (ownerColumnError) {
      log.warn("Listing owner-column probe failed during create", {
        error: ownerColumnError instanceof Error ? ownerColumnError.message : "Unknown error",
        userId: user.id,
      });
      return NextResponse.json(
        {
          error: "Service temporarily unavailable",
          detail: "Listing ownership metadata is unavailable. Please retry shortly.",
        },
        { status: 503 }
      );
    }

    // ── Get account profile ──────────────────────────────────
    const verification = await resolveAccountVerification(supabase, user.id);
    let profile = verification.profile;

    if (!profile) {
      profile = await ensureAccountProfile(getAdmin(), user);
      if (!profile) {
        return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
      }
      // Auto-created profiles are always "incomplete" → caught by isVerifiedMember below
    }

    if (!isVerifiedMember(verification.accountVerificationStatus)) {
      return NextResponse.json(createVerificationRequiredPayload(AREA), { status: 403 });
    }

    // Phone gate: prevent content creation without a verified phone number
    if (!(await hasPhoneNumber(supabase, user.id))) {
      return NextResponse.json(
        { error: "Phone number required", redirectUrl: "/dashboard/complete-profile" },
        { status: 403 }
      );
    }

    // ── Parse body ───────────────────────────────────────────
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Validate with Zod schema ─────────────────────────────
    const parsed = listingSchema.safeParse(body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        {
          error: "Validation failed",
          details: firstError?.message || "Invalid listing data",
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 422 }
      );
    }

    const data = parsed.data;

    // ── Idempotency guard: reject duplicate submissions ──────
    // If the same user submitted a listing with the identical title
    // within the last 2 minutes, return the existing listing instead
    // of creating a duplicate (protects against network retries).
    {
      const { data: recentDupe } = await applyOwnerFilter(
        supabase
          .from("listings")
          .select("id")
          .eq("title", data.title)
          .gte("created_at", new Date(Date.now() - 120_000).toISOString()),
        ownerColumn,
        user.id
      )
        .limit(1)
        .maybeSingle();

      if (recentDupe) {
        log.warn("Duplicate listing submission detected", {
          userId: user.id,
          existingId: recentDupe.id,
        });
        return NextResponse.json({ id: recentDupe.id, deduplicated: true }, { status: 200 });
      }
    }

    // ── Check entitlement / plan limits ──────────────────────
    // Check if user has a paid entitlement (not expired)
    const { data: activeEntitlement, error: entitlementError } = await supabase
      .from("entitlements")
      .select("tier")
      .eq("user_id", user.id)
      .eq("area", AREA)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (entitlementError) {
      log.error("Failed to check entitlements", {
        userId: user.id,
        error: entitlementError.message,
      });
      return NextResponse.json({ error: "Unable to verify subscription status" }, { status: 503 });
    }

    const hasPaidPlan = !!activeEntitlement;
    const tier = (activeEntitlement?.tier as string) || null;
    const postingLimitBypassEnabled = isPostingLimitBypassEnabled();

    // ── Enforce photo/video limits based on plan ─────────────
    // Validate before claiming a free-post slot so validation failures never
    // consume one of the user's free posts.
    const ent =
      hasPaidPlan && tier
        ? getEntitlements(tier as PlanTier, AREA)
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          };

    if (data.images.length > ent.maxPhotos) {
      return NextResponse.json(
        {
          error: `Maximum ${ent.maxPhotos} photos allowed on your plan`,
        },
        { status: 422 }
      );
    }

    if (data.videos.length > 0 && !ent.videoAllowed) {
      return NextResponse.json(
        { error: "Video upload is not available on your current plan." },
        { status: 422 }
      );
    }

    if (data.videos.length > ent.maxVideos) {
      return NextResponse.json(
        { error: `Maximum ${ent.maxVideos} videos allowed on your plan` },
        { status: 422 }
      );
    }

    const freePostContentId = crypto.randomUUID();
    let freePostClaimed = false;

    // Check free post availability for unpaid users
    if (!hasPaidPlan && !postingLimitBypassEnabled) {
      try {
        freePostClaimed = await claimFreePostSlot(getAdmin(), {
          userId: user.id,
          area: AREA,
          contentId: freePostContentId,
        });
      } catch (claimError) {
        log.error("Failed to claim free post slot", {
          error: claimError instanceof Error ? claimError.message : "Unknown error",
          userId: user.id,
        });
        return NextResponse.json({ error: "Failed to reserve free post" }, { status: 500 });
      }

      if (!freePostClaimed) {
        return NextResponse.json(
          {
            error: "Free post limit reached",
            reason:
              "You have already used all 2 free posts for Mzansi Market. Subscribe to a plan to post more.",
            upgradeUrl: "/billing",
          },
          { status: 403 }
        );
      }
    }

    if (hasPaidPlan && tier && !postingLimitBypassEnabled) {
      // Paid plan — atomic listing-count guard to prevent TOCTOU race (#25)
      const ent = getEntitlements(tier as PlanTier, AREA);

      if (ent.maxAllowed !== -1) {
        const admin = getAdmin();
        const { data: underLimit, error: rpcError } = await admin.rpc("check_listing_limit", {
          p_user_id: user.id,
          p_area: AREA,
          p_max_allowed: ent.maxAllowed,
        });

        if (rpcError) {
          log.error("check_listing_limit RPC failed", { error: rpcError.message });
          return NextResponse.json({ error: "Unable to verify listing limit" }, { status: 500 });
        }

        if (!underLimit) {
          const check = canCreateListing(ent.maxAllowed, tier as PlanTier, AREA);
          return NextResponse.json(
            { error: "Listing limit reached", reason: check.reason },
            { status: 403 }
          );
        }
      }
    }

    // ── Prepare listing record ───────────────────────────────
    const priceCents = Math.round(+(data.price_zar * 100).toPrecision(12));

    const listingRecord = withOwnerField(
      {
        id: freePostContentId,
        title: data.title,
        description: data.description,
        price_cents: priceCents,
        price_negotiable: data.negotiable,
        category: data.category,
        attributes: "attributes" in data ? data.attributes : {},
        condition: data.condition || null,
        location_province: data.province || null,
        location_city: data.city || null,
        location_suburb: data.town || null,
        location_address: data.address || null,
        status: "pending_moderation",
        area: AREA,
        photos: data.images,
        videos: data.videos,
        video_thumbnail: data.videoThumbnail || null,
        logo_url: data.logo_url || null,
        contact_methods: data.contactMethods,
        media_width: data.media_width ?? null,
        media_height: data.media_height ?? null,
        focal_x: data.focal_x ?? 0.5,
        focal_y: data.focal_y ?? 0.5,
      },
      ownerColumn,
      user.id
    );

    // ── Insert listing ───────────────────────────────────────
    let newListing: { id: string } | null = null;
    let insertError: ListingInsertErrorLike = null;
    const insertAttempts = [[], LISTING_INSERT_COMPAT_FIELDS] as const;

    for (let attemptIndex = 0; attemptIndex < insertAttempts.length; attemptIndex += 1) {
      const omittedFields = insertAttempts[attemptIndex];
      const insertPayload = omitListingCompatFields(listingRecord, omittedFields);
      const result = await supabase.from("listings").insert(insertPayload).select("id").single();

      newListing = result.data;
      insertError = result.error;

      if (!insertError && newListing) {
        break;
      }

      const nextOmittedFields = insertAttempts[attemptIndex + 1];
      if (!nextOmittedFields) {
        break;
      }

      if (!canRetryListingInsertForCompat(insertError, nextOmittedFields)) {
        break;
      }

      log.warn("Retrying listing insert with compatibility payload", {
        userId: user.id,
        error: insertError?.message,
        omittedFields: nextOmittedFields,
      });
    }

    if (insertError) {
      const insertErrorMessage = insertError.message ?? "";

      log.error("Failed to insert listing", {
        error: insertErrorMessage,
        userId: user.id,
      });
      // Release free post slot if listing insert failed
      if (freePostClaimed) {
        try {
          await releaseFreePostSlot(getAdmin(), {
            userId: user.id,
            area: AREA,
            contentId: freePostContentId,
            reason: "create_failed",
          });
        } catch (rollbackError) {
          log.error("Failed to rollback free post claim after listing insert failure", {
            userId: user.id,
            error: rollbackError instanceof Error ? rollbackError.message : "Unknown error",
          });
        }
      }
      const details =
        insertErrorMessage.includes("schema cache") ||
        LISTING_INSERT_COMPAT_FIELDS.some((field) => insertErrorMessage.includes(field))
          ? "Listing could not be saved right now. Please try again shortly."
          : "Listing could not be saved. Please try again shortly.";
      return NextResponse.json({ error: "Failed to create listing", details }, { status: 500 });
    }

    if (!newListing) {
      log.error("Listing insert returned no row", {
        userId: user.id,
      });
      if (freePostClaimed) {
        try {
          await releaseFreePostSlot(getAdmin(), {
            userId: user.id,
            area: AREA,
            contentId: freePostContentId,
            reason: "create_failed",
          });
        } catch (rollbackError) {
          log.error("Failed to rollback free post claim after empty insert result", {
            userId: user.id,
            error: rollbackError instanceof Error ? rollbackError.message : "Unknown error",
          });
        }
      }
      return NextResponse.json(
        { error: "Failed to create listing", details: "Listing could not be saved right now." },
        { status: 500 }
      );
    }

    // ── Post-insert limit check (closes TOCTOU window for paid plans) ──
    if (hasPaidPlan && tier && !postingLimitBypassEnabled) {
      const postCountQuery = applyOwnerFilter(
        supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .neq("status", "rejected"),
        ownerColumn,
        user.id
      );
      const { count: postInsertCount } = await postCountQuery;
      const postCheck = canCreateListing((postInsertCount ?? 0) - 1, tier as PlanTier, AREA);
      if (!postCheck.allowed) {
        // Over limit due to concurrent insert — roll back
        const { error: rollbackErr } = await getAdmin()
          .from("listings")
          .delete()
          .eq("id", newListing.id);
        if (rollbackErr) {
          log.error("Failed to roll back listing — orphaned record", {
            listingId: newListing.id,
            userId: user.id,
            error: rollbackErr.message,
          });
        }
        log.warn("Rolled back listing due to concurrent limit breach", {
          listingId: newListing.id,
          userId: user.id,
          count: postInsertCount,
        });
        return NextResponse.json(
          { error: "Listing limit reached", reason: postCheck.reason },
          { status: 403 }
        );
      }
    }

    await confirmMediaUploads({
      supabase: getAdmin(),
      userId: user.id,
      contentType: "listing",
      contentId: newListing.id,
      urls: [...data.images, ...data.videos, data.videoThumbnail, data.logo_url],
    });

    // ── Audit log (best-effort) ────────────────────────────────
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_created",
        targetType: "listing",
        targetId: newListing.id,
        area: AREA,
        metadata: {
          category: data.category,
          priceCents,
          hasPaidPlan,
          tier,
        },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    log.info("Listing created", {
      listingId: newListing.id,
      userId: user.id,
      category: data.category,
    });

    if (shouldSendOwnerLifecycleNotifications()) {
      void createNotification({
        userId: user.id,
        type: "info",
        title: "Listing submitted",
        message: `\"${data.title}\" was submitted for review.`,
        href: "/dashboard/listings",
      });
    }

    void notifyStaffForAdminEvent({
      capability: "queue:view",
      title: "New listing submission",
      message: `\"${data.title}\" is waiting in the moderation queue.`,
      href: "/admin/moderation",
      excludeUserId: user.id,
    });

    return NextResponse.json(
      {
        id: newListing.id,
        message: "Listing submitted for review",
        status: "pending_moderation",
      },
      { status: 201 }
    );
  } catch (err) {
    log.error("Unexpected error in listing creation", {
      error: err instanceof Error ? err.message : "unknown",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
