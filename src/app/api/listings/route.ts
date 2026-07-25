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
import {
  confirmMediaUploads,
  MediaUploadConfirmationError,
} from "@/lib/media/confirm-media-uploads";
import {
  getPostExpiryIso,
  hasAcceptedPostTerms,
  recordPostTermsAcceptance,
} from "@/lib/posting/post-lifecycle";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";
import {
  LISTING_INSERT_COMPAT_FIELDS,
  LISTING_SELECT_FALLBACK_FIELDS,
  applyBaseMarketFilters,
  canRetryListingInsertForCompat,
  createListingSelectAttempts,
  isPlaceholderListing,
  matchesAttributeFilters,
  normalizeListingSelectShape,
  omitListingCompatFields,
  type ListingInsertErrorLike,
} from "./_lib/listing-route-helpers";

const log = createLogger("ListingCreate");
const AREA: MarketplaceArea = "MZANSI_MARKET";

/**
 * Route ownership:
 * - Auth/session/verified posting gates: account + posting helpers.
 * - Validation: listingSchema and marketplace query schemas.
 * - Public reads: service-role boundary owned here; keep status/area filters and tests aligned.
 * - Storage/media: confirmMediaUploads owns persisted media reconciliation.
 * - Audit/notifications/free-post ledger: best-effort side effects after content state changes.
 */
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

/**
 * GET /api/listings
 *
 * Public listing discovery endpoint for Mzansi Market with filtering and pagination.
 *
 * SERVICE_ROLE_PUBLIC_READ_CHECKLIST:
 * - createAdminClient is used only after validating query params and rate limiting.
 * - Every select attempt must include status=live and area=MZANSI_MARKET.
 * - Placeholder/demo rows are filtered before returning public results.
 * - Regression coverage lives in service-role-public-read-checklist.test.ts.
 *
 * SECURITY BOUNDARY: uses the service-role admin client for public reads, so
 * the explicit application filters below are mandatory. Keep status/area
 * filters in every select attempt and keep the regression tests in
 * `listing-create-route.test.ts` aligned with this boundary.
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
    const selectAttempts = createListingSelectAttempts(ownerColumn);
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
              applyVisibleExpiryFilter(
                admin.from("listings").select(selectClause).eq("status", "live").eq("area", AREA)
              ),
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
            applyVisibleExpiryFilter(
              admin
                .from("listings")
                .select(selectClause, { count: "exact" })
                .eq("status", "live")
                .eq("area", AREA)
            ),
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
    const sellersByUserId = new Map(
      serializedSellers.map((seller) => [String(seller.user_id), seller])
    );
    const serializedListings = listings.map((listing) => {
      const listingId = String(listing.id ?? "");
      const fallbackViewCount = engagementAvailable
        ? (viewCountResult.data.get(listingId) ?? null)
        : null;
      const likeSummary = engagementAvailable ? likeSummaryResult.data.get(listingId) : undefined;
      const seller = listing.owner_id ? sellersByUserId.get(String(listing.owner_id)) : undefined;

      // Strip owner identifiers from public rows (POPIA data minimization);
      // the embedded seller carries the public-safe display fields.
      const { owner_id: _ownerId, seller_id: _sellerId, ...publicListing } = listing;

      return {
        ...publicListing,
        seller: seller
          ? {
              display_name: seller.display_name,
              account_verification_status: seller.account_verification_status,
            }
          : null,
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
    const verification = await resolveAccountVerification(supabase, user.id, {
      includeStepsWhenVerified: true,
    });
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
    if (!hasAcceptedPostTerms(data.termsAccepted)) {
      return NextResponse.json(
        { error: "Posting terms must be accepted before creating a post" },
        { status: 422 }
      );
    }

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

    try {
      await confirmMediaUploads({
        supabase: getAdmin(),
        userId: user.id,
        contentType: "listing",
        contentId: freePostContentId,
        urls: [...data.images, ...data.videos, data.videoThumbnail, data.logo_url],
      });
    } catch (mediaError) {
      if (mediaError instanceof MediaUploadConfirmationError) {
        return NextResponse.json({ error: "Invalid media upload" }, { status: 422 });
      }
      throw mediaError;
    }

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
              "You have already used your free post for Mzansi Market. Subscribe to a plan to post more.",
            upgradeUrl: "/billing",
          },
          { status: 403 }
        );
      }
    }

    // The paid-plan post limit is enforced atomically inside
    // insert_listing_with_limit: the per-user advisory lock is held across
    // both the count check and the INSERT, closing the TOCTOU race (#25/M1).
    // -1 skips the check (unlimited plans, bypass mode, and free-post users
    // whose limit is enforced by the free_posts_used ledger).
    const maxAllowedForInsert =
      hasPaidPlan && tier && !postingLimitBypassEnabled
        ? getEntitlements(tier as PlanTier, AREA).maxAllowed
        : -1;

    // ── Prepare listing record ───────────────────────────────
    const priceCents = Math.round(+(data.price_zar * 100).toPrecision(12));

    // Ownership is enforced inside insert_listing_with_limit (forced to the
    // authenticated user), so the payload deliberately carries no owner field.
    const listingRecord = {
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
      expires_at: getPostExpiryIso({ hasPaidPlan }),
    };

    // ── Insert listing (atomic limit check + insert) ─────────
    let newListing: { id: string } | null = null;
    let insertError: ListingInsertErrorLike = null;
    let limitReached = false;
    const insertAttempts = [[], LISTING_INSERT_COMPAT_FIELDS] as const;

    for (let attemptIndex = 0; attemptIndex < insertAttempts.length; attemptIndex += 1) {
      const omittedFields = insertAttempts[attemptIndex];
      const insertPayload = omitListingCompatFields(listingRecord, omittedFields);
      const { data: rpcData, error: rpcError } = await getAdmin().rpc("insert_listing_with_limit", {
        p_user_id: user.id,
        p_area: AREA,
        p_max_allowed: maxAllowedForInsert,
        p_data: insertPayload,
      });

      const limitRow = rpcData as { limit_reached?: boolean } | null;
      if (!rpcError && limitRow?.limit_reached === true) {
        limitReached = true;
        break;
      }

      const insertedRow = rpcData as { id?: string } | null;
      newListing = !rpcError && insertedRow?.id ? { id: insertedRow.id } : null;
      insertError = rpcError;

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

    if (limitReached) {
      const check = canCreateListing(maxAllowedForInsert, tier as PlanTier, AREA);
      return NextResponse.json(
        { error: "Listing limit reached", reason: check.reason },
        { status: 403 }
      );
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

    try {
      await recordPostTermsAcceptance(getAdmin(), {
        userId: user.id,
        area: AREA,
        contentId: newListing.id,
      });
    } catch (consentError) {
      // Best-effort: the listing row already exists, so failing the response
      // here would orphan the create and make client retries duplicate it.
      log.error("Failed to record post terms acceptance", {
        userId: user.id,
        listingId: newListing.id,
        error: consentError instanceof Error ? consentError.message : "Unknown error",
      });
      try {
        await logAuditEvent({
          actorId: user.id,
          actorRole: "member",
          action: "consent_updated",
          targetType: "listing",
          targetId: newListing.id,
          area: AREA,
          metadata: { termsAcceptanceRecorded: false },
        });
      } catch {
        // non-fatal
      }
    }

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
