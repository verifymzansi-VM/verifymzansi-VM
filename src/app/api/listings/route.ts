import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listingSchema } from "@/lib/validations/listing";
import { logAuditEvent } from "@/lib/services/audit";
import { getEntitlements, canCreateListing } from "@/lib/services/entitlements";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { parseJsonRequest } from "@/lib/utils/api";
import { isPostingLimitBypassEnabled } from "../../../lib/utils/posting-limit-bypass";
import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecords,
  readAccountVerificationStatus,
  withOwnerColumn,
  withOwnerField,
} from "@/lib/account/compat";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import { parseMarketplaceFiltersFromSearchParams } from "@/lib/utils/marketplace-query";
import { createVerificationRequiredPayload, isVerifiedMember } from "@/app/post/_lib/post-access";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { queryWithSelectFallbacks } from "@/lib/utils/marketplace-select-fallback";

const log = createLogger("ListingCreate");
const AREA: MarketplaceArea = "MZANSI_MARKET";
const LISTING_SELECT_FALLBACK_FIELDS = ["featured_until", "condition", "video_thumbnail"] as const;

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
    const safeSearch = filters.query.replace(/[,.()\\/]/g, "");
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

function matchesAttributeFilter(attributeValue: unknown, filterValue: string | boolean) {
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

  return String(attributeValue).toLowerCase().includes(filterValue.toLowerCase());
}

function matchesAttributeFilters(
  attributes: Record<string, unknown> | null | undefined,
  filters: Record<string, string | boolean>
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
  }));
}

/**
 * GET /api/listings
 *
 * Public listing discovery endpoint for Mzansi Market with filtering and pagination.
 */
export async function GET(request: NextRequest) {
  try {
    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "listings");
    const filters = parseMarketplaceFiltersFromSearchParams(request.nextUrl.searchParams);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") || "24", 10))
    );
    const offset = (filters.page - 1) * limit;
    const selectAttempts = [
      {
        select: withOwnerColumn(
          "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, location_province, location_city, created_at, boost_until, featured_until, featured",
          ownerColumn
        ),
        omittedFields: [] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, video_thumbnail, location_province, location_city, created_at, boost_until, featured",
          ownerColumn
        ),
        omittedFields: ["featured_until"] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, title, description, price_cents, price_negotiable, category, attributes, photos, videos, video_thumbnail, location_province, location_city, created_at, boost_until, featured_until, featured",
          ownerColumn
        ),
        omittedFields: ["condition"] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, title, description, price_cents, price_negotiable, category, condition, attributes, photos, videos, location_province, location_city, created_at, boost_until, featured_until, featured",
          ownerColumn
        ),
        omittedFields: ["video_thumbnail"] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, title, description, price_cents, price_negotiable, category, attributes, photos, videos, location_province, location_city, created_at, boost_until, featured",
          ownerColumn
        ),
        omittedFields: ["featured_until", "condition", "video_thumbnail"] as const,
      },
    ] as const;
    const hasAttributeFilters = Object.keys(filters.attributes).length > 0;

    let listings: Record<string, unknown>[] = [];
    let total = 0;
    if (hasAttributeFilters) {
      const batchSize = 500;
      let from = 0;

      while (true) {
        const batchResult = await queryWithSelectFallbacks({
          attempts: selectAttempts,
          fallbackFields: LISTING_SELECT_FALLBACK_FIELDS,
          runQuery: (selectClause) =>
            applyBaseMarketFilters(
              admin
                .from("listings")
                .select(selectClause)
                .eq("status", "live")
                .eq("area", AREA)
                .not("title", "ilike", "%seed%")
                .not("title", "ilike", "%[seed]%")
                .not("title", "ilike", "%demo%")
                .not("title", "ilike", "%sample%"),
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
                code: error.code,
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
            admin
              .from("listings")
              .select(selectClause, { count: "exact" })
              .eq("status", "live")
              .eq("area", AREA)
              .not("title", "ilike", "%seed%")
              .not("title", "ilike", "%[seed]%")
              .not("title", "ilike", "%demo%")
              .not("title", "ilike", "%sample%"),
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
              code: error.code,
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

      listings = normalizeOwnerRecords(filteredListings);
      total = Math.max(
        0,
        (count ?? filteredListings.length) - ((data?.length ?? 0) - filteredListings.length)
      );
    }

    listings = normalizeOwnerRecords(listings);

    const sellerIds = Array.from(
      new Set(listings.map((listing) => String(listing.owner_id)).filter(Boolean))
    );

    const { data: sellers } = sellerIds.length
      ? await admin
          .from("account_profiles")
          .select("user_id, display_name, account_verification_status")
          .in("user_id", sellerIds)
      : { data: [] as Array<Record<string, unknown>> };

    const serializedSellers =
      sellers?.map((seller) => ({
        user_id: seller.user_id,
        display_name: seller.display_name,
        account_verification_status: readAccountVerificationStatus(seller),
      })) ?? [];

    return NextResponse.json({
      listings,
      sellers: serializedSellers,
      total,
      page: filters.page,
      limit,
    });
  } catch (err) {
    log.error("Unexpected error in listing fetch", {
      error: err instanceof Error ? err.message : "unknown",
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
        { status: 429 }
      );
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "listings");

    // ── Get account profile ──────────────────────────────────
    const { data: profile } = await admin
      .from("account_profiles")
      .select("id, account_verification_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    if (!isVerifiedMember(readAccountVerificationStatus(profile))) {
      return NextResponse.json(createVerificationRequiredPayload(AREA), { status: 403 });
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

    // ── Check entitlement / plan limits ──────────────────────
    // Check if user has a paid entitlement (not expired)
    const { data: activeEntitlement } = await admin
      .from("entitlements")
      .select("tier")
      .eq("user_id", user.id)
      .eq("area", AREA)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasPaidPlan = !!activeEntitlement;
    const tier = (activeEntitlement?.tier as string) || null;
    const postingLimitBypassEnabled = isPostingLimitBypassEnabled();

    // Check free post availability for unpaid users
    if (!hasPaidPlan && !postingLimitBypassEnabled) {
      const { data: freePostRow } = await admin
        .from("free_posts_used")
        .select("id")
        .eq("user_id", user.id)
        .eq("area", AREA)
        .maybeSingle();

      if (freePostRow) {
        return NextResponse.json(
          {
            error: "Free post already used",
            reason:
              "You have already used your free post for Mzansi Market. Subscribe to a plan to post more.",
          },
          { status: 403 }
        );
      }
    }

    if (hasPaidPlan && tier && !postingLimitBypassEnabled) {
      // Paid plan — check listing count against plan limits
      const countQuery = applyOwnerFilter(
        admin
          .from("listings")
          .select("id", { count: "exact", head: true })
          .neq("status", "rejected"),
        ownerColumn,
        user.id
      );

      const { count } = await countQuery;

      const currentCount = count ?? 0;
      const check = canCreateListing(currentCount, tier as PlanTier, AREA);

      if (!check.allowed) {
        return NextResponse.json(
          { error: "Listing limit reached", reason: check.reason },
          { status: 403 }
        );
      }
    }

    // ── Enforce photo/video limits based on plan ─────────────
    const ent =
      hasPaidPlan && tier
        ? getEntitlements(tier as PlanTier, AREA)
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          };

    const rawVideos = Array.isArray((body as Record<string, unknown>).videos)
      ? ((body as Record<string, unknown>).videos as unknown[])
      : [];
    if (rawVideos.some((video) => typeof video !== "string")) {
      return NextResponse.json({ error: "Videos must be an array of URLs" }, { status: 422 });
    }

    if (data.images.length > ent.maxPhotos) {
      return NextResponse.json(
        {
          error: `Maximum ${ent.maxPhotos} photos allowed on your plan`,
        },
        { status: 422 }
      );
    }

    if (rawVideos.length > 0 && !ent.videoAllowed) {
      return NextResponse.json(
        { error: "Video upload is not available on your current plan." },
        { status: 422 }
      );
    }

    if (rawVideos.length > ent.maxVideos) {
      return NextResponse.json(
        { error: `Maximum ${ent.maxVideos} videos allowed on your plan` },
        { status: 422 }
      );
    }

    // ── Prepare listing record ───────────────────────────────
    const priceCents = Math.round(data.price_zar * 100);

    const listingRecord = withOwnerField(
      {
        title: data.title,
        description: data.description,
        price_cents: priceCents,
        price_negotiable: data.negotiable,
        category: data.category,
        attributes: "attributes" in data ? data.attributes : {},
        condition: data.condition || null,
        location_province: data.province || null,
        location_city: data.city || null,
        location_suburb: (body as Record<string, unknown>).town || null,
        status: "pending_moderation",
        area: AREA,
        photos: data.images,
        videos: rawVideos,
        video_thumbnail: (body as Record<string, unknown>).videoThumbnail || null,
        contact_methods: (body as Record<string, unknown>).contactMethods || ["call"],
      },
      ownerColumn,
      user.id
    );

    // ── Insert listing ───────────────────────────────────────
    const { data: newListing, error: insertError } = await admin
      .from("listings")
      .insert(listingRecord)
      .select("id")
      .single();

    if (insertError) {
      log.error("Failed to insert listing", {
        error: insertError.message,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Failed to create listing", details: insertError.message },
        { status: 500 }
      );
    }

    // ── Mark free post as used if no paid entitlement ────────
    if (!hasPaidPlan && !postingLimitBypassEnabled) {
      const { error: freePostError } = await admin
        .from("free_posts_used")
        .upsert({ user_id: user.id, area: AREA }, { onConflict: "user_id,area" });

      if (freePostError) {
        log.error("Failed to mark free post as used", {
          error: freePostError.message,
          userId: user.id,
        });
        // Don't fail the request — the listing was already created
      }
    }

    // ── Audit log ────────────────────────────────────────────
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

    log.info("Listing created", {
      listingId: newListing.id,
      userId: user.id,
      category: data.category,
    });

    return NextResponse.json(
      { id: newListing.id, message: "Listing submitted for review" },
      { status: 201 }
    );
  } catch (err) {
    log.error("Unexpected error in listing creation", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
