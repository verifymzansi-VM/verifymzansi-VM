import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest, parseAndValidateSearchParams } from "@/lib/utils/api";
import { businessSchema } from "@/lib/validations/business-unified";
import { getEntitlements, canCreateListing } from "@/lib/services/entitlements";
import { checkLocalRateLimit, checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { isPostingLimitBypassEnabled } from "@/lib/utils/posting-limit-bypass";
import {
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecords,
  withOwnerColumn,
  withOwnerField,
  type OwnerColumn,
} from "@/lib/account/compat";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { queryWithSelectFallbacks } from "@/lib/utils/marketplace-select-fallback";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import {
  BUSINESS_SLUG_CONFLICT_RESPONSE,
  isBusinessSlugConflictError,
} from "@/lib/businesses/slug-conflict";
import {
  createBooleanFlagSchema,
  createBoundedIntegerSchema,
  optionalTrimmedStringSchema,
} from "@/lib/validations/shared";
import {
  normalizeBusinessCategoryParam,
  normalizeBusinessTypeParam,
} from "@/lib/utils/marketplace-query";
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
import { enforceVerifiedPostingAccess } from "@/app/api/_lib/verified-posting-access";
import { buildBusinessMutationPayload } from "@/app/api/businesses/_lib/build-business-mutation-payload";
import { confirmMediaUploads } from "@/lib/media/confirm-media-uploads";

const log = createLogger("BusinessesCRUD");
const AREA: MarketplaceArea = "MZANSI_BUSINESS";
const BUSINESS_SELECT_FALLBACK_FIELDS = [
  "gallery_photos",
  "business_details",
  "featured_until",
  "published_at",
  "video_thumbnail",
  "slug",
  "subcategory",
] as const;
const businessesQuerySchema = z.object({
  categories_only: createBooleanFlagSchema(false),
  mine: createBooleanFlagSchema(false),
  type: optionalTrimmedStringSchema,
  category: optionalTrimmedStringSchema,
  subcategory: optionalTrimmedStringSchema,
  province: optionalTrimmedStringSchema,
  city: optionalTrimmedStringSchema,
  q: optionalTrimmedStringSchema,
  page: createBoundedIntegerSchema({
    defaultValue: 1,
    min: 1,
    max: 10_000,
    fieldName: "page",
  }),
  limit: createBoundedIntegerSchema({
    defaultValue: 24,
    min: 1,
    max: 50,
    fieldName: "limit",
  }),
});

function normalizeBusinessSelectShape(
  businesses: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return businesses.map((business) => ({
    ...business,
    gallery_photos: business.gallery_photos ?? null,
    business_details: business.business_details ?? null,
    subcategory: business.subcategory ?? null,
  }));
}

function redactBusinessListContactFields(
  businesses: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return businesses.map((business) => {
    const { phone: _phone, whatsapp: _whatsapp, email: _email, ...safeBusiness } = business;
    return safeBusiness;
  });
}

/**
 * POST /api/businesses
 *
 * Create a new Mzansi Business listing.
 * Requires an authenticated, verified account.
 */
export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let admin: ReturnType<typeof createAdminClient> | null = null;
    const getAdmin = () => {
      admin ??= createAdminClient();
      return admin;
    };
    let ownerColumn: OwnerColumn;
    try {
      ownerColumn = await getOwnerColumn(supabase, "businesses");
    } catch (ownerColumnError) {
      log.warn("Businesses owner-column probe failed during create", {
        error: ownerColumnError instanceof Error ? ownerColumnError.message : "Unknown error",
        userId: user.id,
      });
      return NextResponse.json(
        {
          error: "Service temporarily unavailable",
          detail: "Business ownership metadata is unavailable. Please retry shortly.",
        },
        { status: 503 }
      );
    }
    const ip = getClientIp(request);
    const rl = await checkRateLimit({
      key: user.id,
      action: "business_create",
      deviceId: ip,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", retryAfter: rl.retryAfter },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const accessBlock = await enforceVerifiedPostingAccess(supabase, user.id, AREA);
    if (accessBlock) {
      return accessBlock;
    }

    const parsedBody = await parseAndValidateJsonRequest(request, businessSchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Validation failed",
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const data = parsedBody.data;

    // Tourism businesses belong in the PROMOTIONS_EVENTS marketplace area.
    const effectiveArea: MarketplaceArea =
      data.category === "tourism_hospitality" ? "PROMOTIONS_EVENTS" : AREA;

    const { data: activeEntitlement, error: entitlementError } = await supabase
      .from("entitlements")
      .select("tier")
      .eq("user_id", user.id)
      .eq("area", effectiveArea)
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

    if (hasPaidPlan && tier && !postingLimitBypassEnabled) {
      // Paid plan — atomic business-count guard to prevent TOCTOU race
      const ent0 = getEntitlements(tier as PlanTier, effectiveArea);

      if (ent0.maxAllowed !== -1) {
        const { data: underLimit, error: rpcError } = await getAdmin().rpc("check_business_limit", {
          p_user_id: user.id,
          p_area: effectiveArea,
          p_max_allowed: ent0.maxAllowed,
        });

        if (rpcError) {
          log.error("check_business_limit RPC failed", { error: rpcError.message });
          return NextResponse.json({ error: "Unable to verify business limit" }, { status: 500 });
        }

        if (!underLimit) {
          const check = canCreateListing(ent0.maxAllowed, tier as PlanTier, effectiveArea);
          return NextResponse.json(
            { error: "Business limit reached", reason: check.reason },
            { status: 403 }
          );
        }
      }
    }

    const ent =
      hasPaidPlan && tier
        ? getEntitlements(tier as PlanTier, effectiveArea)
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          };

    if ((data.gallery_photos?.length ?? 0) > ent.maxPhotos) {
      return NextResponse.json(
        { error: `Maximum ${ent.maxPhotos} gallery photos allowed on your plan` },
        { status: 422 }
      );
    }

    if (data.cover_video && !ent.videoAllowed) {
      return NextResponse.json(
        { error: "Video is not available on your current plan." },
        { status: 422 }
      );
    }

    const { data: slugConflict } = await getAdmin()
      .from("businesses")
      .select("id")
      .eq("slug", data.slug)
      .maybeSingle();

    if (slugConflict) {
      return NextResponse.json(BUSINESS_SLUG_CONFLICT_RESPONSE, { status: 409 });
    }

    const freePostContentId = crypto.randomUUID();
    let freePostClaimed = false;

    if (!hasPaidPlan && !postingLimitBypassEnabled) {
      try {
        freePostClaimed = await claimFreePostSlot(getAdmin(), {
          userId: user.id,
          area: effectiveArea,
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
              "You have already used all 2 free posts for Mzansi Business. Subscribe to a plan to post more.",
            upgradeUrl: "/billing",
          },
          { status: 403 }
        );
      }
    }

    const businessPayload = {
      id: freePostContentId,
      area: effectiveArea,
      ...buildBusinessMutationPayload(data),
      status: "pending_moderation" as const,
    };

    const { data: business, error: insertError } = await supabase
      .from("businesses")
      .insert(withOwnerField(businessPayload, ownerColumn, user.id))
      .select("id")
      .single();

    if (insertError || !business) {
      if (isBusinessSlugConflictError(insertError)) {
        if (freePostClaimed) {
          try {
            await releaseFreePostSlot(getAdmin(), {
              userId: user.id,
              area: effectiveArea,
              contentId: freePostContentId,
              reason: "create_failed",
            });
          } catch (cleanupErr) {
            log.error("Failed to clean up free_posts_used after slug conflict", {
              error: cleanupErr instanceof Error ? cleanupErr.message : "Unknown error",
              userId: user.id,
            });
          }
        }

        return NextResponse.json(BUSINESS_SLUG_CONFLICT_RESPONSE, { status: 409 });
      }

      log.error("Failed to create business", { error: insertError?.message });
      if (freePostClaimed) {
        try {
          await releaseFreePostSlot(getAdmin(), {
            userId: user.id,
            area: effectiveArea,
            contentId: freePostContentId,
            reason: "create_failed",
          });
        } catch (cleanupErr2) {
          log.error("Failed to clean up free_posts_used after insert failure", {
            error: cleanupErr2 instanceof Error ? cleanupErr2.message : "Unknown error",
            userId: user.id,
          });
        }
      }
      return NextResponse.json({ error: "Failed to create business" }, { status: 500 });
    }

    await confirmMediaUploads({
      supabase: getAdmin(),
      userId: user.id,
      contentType: "business",
      contentId: business.id,
      urls: [
        data.logo_url,
        data.cover_photo,
        data.cover_video,
        data.video_thumbnail,
        ...(data.gallery_photos ?? []),
      ],
    });

    // Audit (best-effort)
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_created",
        targetType: "business",
        targetId: business.id,
        area: effectiveArea,
        metadata: { business_type: data.business_type, business_name: data.business_name },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    if (shouldSendOwnerLifecycleNotifications()) {
      void createNotification({
        userId: user.id,
        type: "info",
        title: "Business profile submitted",
        message: `\"${data.business_name}\" was submitted for review.`,
        href: "/dashboard/businesses",
      });
    }

    void notifyStaffForAdminEvent({
      capability: "queue:view",
      title: "New business submission",
      message: `\"${data.business_name}\" is waiting in the moderation queue.`,
      href: "/admin/businesses",
      excludeUserId: user.id,
    });

    return NextResponse.json({ success: true, business: { id: business.id } }, { status: 201 });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to create business" }, { status: 500 });
  }
}

/**
 * GET /api/businesses
 *
 * List live businesses with optional filters.
 * Public endpoint — no auth required.
 * Supports ?categories_only=true to return just category counts for auto-hide.
 */
export async function GET(request: NextRequest) {
  try {
    const hideFixtures = shouldHidePlaywrightFixtures(
      request.cookies?.get?.(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
    );
    const parsedQuery = parseAndValidateSearchParams(
      request.nextUrl.searchParams,
      businessesQuerySchema,
      {
        validationErrorMessage: "Invalid businesses query",
      }
    );
    if (!parsedQuery.success) {
      return parsedQuery.response;
    }
    const query = parsedQuery.data;
    const businessType = query.type ? normalizeBusinessTypeParam(query.type) : undefined;
    const category = query.category ? normalizeBusinessCategoryParam(query.category) : undefined;
    const subcategory = query.subcategory || undefined;

    if (query.type && !businessType) {
      return NextResponse.json({ error: "Invalid business type" }, { status: 400 });
    }
    if (query.category && !category) {
      return NextResponse.json({ error: "Invalid business category" }, { status: 400 });
    }

    // Rate limit public reads by IP (local-only — external worker has wrong
    // limits for read actions; 120 req/min is generous for normal browsing).
    const ip = getClientIp(request) || "unknown";
    const rl = checkLocalRateLimit(ip, "businesses:read", 120);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // Category counts mode — for auto-hiding empty categories
    if (query.categories_only) {
      const admin = createAdminClient();
      const { data: counts, error } = await admin.rpc("get_business_category_counts");

      if (error) {
        // Fallback: manual query
        const { data: businesses } = await admin
          .from("businesses")
          .select("category, business_name, description")
          .eq("status", "live")
          .in("area", ["MZANSI_BUSINESS", "PROMOTIONS_EVENTS"])
          .limit(500);

        const categoryCounts: Record<string, number> = {};
        for (const b of businesses ?? []) {
          if (isPlaceholderMarketplaceContent(b.business_name, b.description)) {
            continue;
          }
          categoryCounts[b.category] = (categoryCounts[b.category] || 0) + 1;
        }
        return NextResponse.json({ categoryCounts });
      }

      const categoryCounts: Record<string, number> = {};
      for (const row of counts ?? []) {
        categoryCounts[row.category] = row.count;
      }
      return NextResponse.json({ categoryCounts });
    }

    // "mine" mode — fetch current user's businesses (requires auth)
    const mine = query.mine;
    if (mine) {
      const supabase = await createClient();
      let ownerColumn: OwnerColumn;
      try {
        ownerColumn = await getOwnerColumn(supabase, "businesses");
      } catch (ownerColumnError) {
        log.warn("Businesses owner-column probe failed for mine query", {
          error: ownerColumnError instanceof Error ? ownerColumnError.message : "Unknown error",
        });
        return NextResponse.json(
          {
            error: "Marketplace temporarily unavailable",
            detail: "Business ownership metadata is unavailable. Please retry shortly.",
          },
          { status: 503 }
        );
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const mineLimit = request.nextUrl.searchParams.has("limit") ? query.limit : 50;
      const { data: myBusinesses } = await applyOwnerFilter(
        supabase
          .from("businesses")
          .select("id, business_name, business_type, category, status, created_at")
          .order("created_at", { ascending: false })
          .limit(mineLimit),
        ownerColumn,
        user.id
      );

      return NextResponse.json({ businesses: myBusinesses ?? [] });
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
    let ownerColumn: OwnerColumn;
    try {
      ownerColumn = await getOwnerColumn(admin, "businesses");
    } catch (ownerColumnError) {
      log.warn("Businesses owner-column probe failed", {
        error: ownerColumnError instanceof Error ? ownerColumnError.message : "Unknown error",
      });
      return NextResponse.json(
        {
          error: "Marketplace temporarily unavailable",
          detail: "Business ownership metadata is unavailable. Please retry shortly.",
        },
        { status: 503 }
      );
    }

    const province = query.province;
    const city = query.city;
    const search = query.q;
    const page = query.page;
    const limit = query.limit;
    const offset = (page - 1) * limit;

    const selectAttempts = [
      {
        select: withOwnerColumn(
          "id, owner_id, business_type, business_name, slug, description, category, subcategory, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at, focal_x, focal_y, media_width, media_height",
          ownerColumn
        ),
        omittedFields: [] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, business_type, business_name, slug, description, category, subcategory, logo_url, cover_photo, cover_video, video_thumbnail, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, business_details, boost_until, featured_until, published_at, created_at, focal_x, focal_y, media_width, media_height",
          ownerColumn
        ),
        omittedFields: ["gallery_photos"] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, business_type, business_name, slug, description, category, subcategory, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, featured_until, published_at, created_at, focal_x, focal_y, media_width, media_height",
          ownerColumn
        ),
        omittedFields: ["business_details"] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, business_type, business_name, slug, description, category, subcategory, logo_url, cover_photo, cover_video, video_thumbnail, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, featured_until, published_at, created_at, focal_x, focal_y, media_width, media_height",
          ownerColumn
        ),
        omittedFields: ["gallery_photos", "business_details"] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, business_type, business_name, description, category, subcategory, logo_url, cover_photo, cover_video, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, created_at, focal_x, focal_y, media_width, media_height",
          ownerColumn
        ),
        omittedFields: [
          "gallery_photos",
          "business_details",
          "featured_until",
          "published_at",
          "video_thumbnail",
          "slug",
        ] as const,
      },
      {
        select: withOwnerColumn(
          "id, owner_id, business_type, business_name, description, category, logo_url, cover_photo, cover_video, location_province, location_city, store_number, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, created_at, focal_x, focal_y, media_width, media_height",
          ownerColumn
        ),
        omittedFields: [
          "gallery_photos",
          "business_details",
          "featured_until",
          "published_at",
          "video_thumbnail",
          "slug",
          "subcategory",
        ] as const,
      },
    ] as const;

    const buildQuery = (selectClause: string) => {
      let query = admin
        .from("businesses")
        .select(selectClause, { count: "exact" })
        .eq("status", "live");

      // When filtering by category (e.g. showroom tourism tab), skip the
      // area filter so tourism businesses with area=PROMOTIONS_EVENTS are
      // still returned. When searching, include both areas so tourism
      // businesses appear in text search results. For general browsing,
      // scope to MZANSI_BUSINESS only.
      if (!category && !search) {
        query = query.eq("area", "MZANSI_BUSINESS");
      } else if (!category) {
        query = query.in("area", ["MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]);
      }

      if (businessType) {
        query = query.eq("business_type", businessType);
      }
      if (category) {
        query = query.eq("category", category);
      }
      if (subcategory && selectClause.includes("subcategory")) {
        query = query.eq("subcategory", subcategory);
      }
      if (province) {
        query = query.eq("location_province", province);
      }
      if (city) {
        query = query.eq("location_city", city);
      }
      if (search) {
        // Defense-in-depth: keep only a bounded, alphanumeric search token
        // before interpolating into PostgREST filter syntax.
        const safeSearch = search
          .replace(/[^A-Za-z0-9\s-]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80)
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        if (safeSearch) {
          const searchFields = [
            `business_name.ilike.%${safeSearch}%`,
            `description.ilike.%${safeSearch}%`,
          ];
          if (selectClause.includes("subcategory")) {
            searchFields.push(`subcategory.ilike.%${safeSearch}%`);
          }
          query = query.or(searchFields.join(","));
        }
      }

      // Only ORDER BY featured_until when the column is in the SELECT clause
      query = query.order("boost_until", { ascending: false, nullsFirst: false });
      if (selectClause.includes("featured_until")) {
        query = query.order("featured_until", { ascending: false, nullsFirst: false });
      }
      return query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
    };

    const result = await queryWithSelectFallbacks({
      attempts: selectAttempts,
      fallbackFields: BUSINESS_SELECT_FALLBACK_FIELDS,
      runQuery: buildQuery,
    });

    const businesses = normalizeBusinessSelectShape(
      (result.data ?? []) as unknown as Array<Record<string, unknown>>
    );
    const count = result.count;
    const error = result.error;

    if (error) {
      log.error("Failed to fetch businesses", {
        error: error.message,
        code: (error as { code?: string }).code,
      });
      return NextResponse.json({ error: "Failed to fetch businesses" }, { status: 500 });
    }

    const normalizedBusinesses = normalizeOwnerRecords(businesses);
    const filteredBusinesses = normalizedBusinesses.filter(
      (b) =>
        !shouldHidePlaywrightFixtureRowWhenEnabled(b, hideFixtures) &&
        !isPlaceholderMarketplaceContent(
          String((b as Record<string, unknown>).business_name ?? ""),
          typeof (b as Record<string, unknown>).description === "string"
            ? ((b as Record<string, unknown>).description as string)
            : null
        )
    );

    const publicBusinesses = redactBusinessListContactFields(filteredBusinesses);
    const businessIds = publicBusinesses
      .map((business) => String(business.id ?? ""))
      .filter((id): id is string => id.length > 0);
    const [viewCountResult, likeSummaryResult] = await Promise.all([
      getContentViewCountMap(admin, "business", businessIds),
      getContentLikeSummaryMap(admin, "business", businessIds, viewerKey),
    ]);
    const engagementAvailable = viewCountResult.ok && likeSummaryResult.ok;
    if (!engagementAvailable) {
      log.error("Failed to load business engagement summary", {
        businessIds,
        viewErrorCode: viewCountResult.errorCode,
        likeErrorCode: likeSummaryResult.errorCode,
      });
    }
    const serializedBusinesses = publicBusinesses.map((business) => {
      const businessId = String(business.id ?? "");
      const likeSummary = engagementAvailable ? likeSummaryResult.data.get(businessId) : undefined;

      return {
        ...business,
        view_count: engagementAvailable ? (viewCountResult.data.get(businessId) ?? null) : null,
        like_count: engagementAvailable ? (likeSummary?.likeCount ?? null) : null,
        viewer_has_liked: likeSummary?.viewerHasLiked ?? false,
      };
    });

    return NextResponse.json({
      businesses: serializedBusinesses,
      engagement_available: engagementAvailable,
      total: Math.max(
        0,
        (count ?? filteredBusinesses.length) -
          (normalizedBusinesses.length - filteredBusinesses.length)
      ),
      page,
      limit,
    });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to fetch businesses" }, { status: 500 });
  }
}
