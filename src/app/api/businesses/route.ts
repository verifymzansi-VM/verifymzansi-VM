import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest, parseAndValidateSearchParams } from "@/lib/utils/api";
import { businessSchema } from "@/lib/validations/business-unified";
import { canCreateListing } from "@/lib/services/entitlements";
import { checkLocalRateLimit, checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { isPostingLimitBypassEnabled } from "@/lib/utils/posting-limit-bypass";
import {
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecords,
  withOwnerColumn,
  type OwnerColumn,
} from "@/lib/account/compat";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { queryWithSelectFallbacks } from "@/lib/utils/marketplace-select-fallback";
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
import {
  enforcePostingMediaLimits,
  getActivePostingPlanOrResponse,
} from "@/app/api/_lib/posting-entitlements";
import { requirePostingMutationSession } from "@/app/api/_lib/posting-mutation-session";
import { buildBusinessMutationPayload } from "@/app/api/businesses/_lib/build-business-mutation-payload";
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

const log = createLogger("BusinessesCRUD");
const AREA: MarketplaceArea = "MZANSI_BUSINESS";

/**
 * Route ownership:
 * - Auth/session/verified posting gates: shared posting API helpers.
 * - Validation: businessSchema, business query schema, and category/type normalizers.
 * - Public reads: service-role boundary owned here; keep live/area/contact redaction tests aligned.
 * - Storage/media: confirmMediaUploads and business mutation payload builder.
 * - Audit/notifications/free-post ledger: best-effort side effects after content state changes.
 */
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
    const session = await requirePostingMutationSession(request, log);
    if (session.response) return session.response;
    const { supabase, user, getAdmin } = session;

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

    let ownerColumn: OwnerColumn;
    try {
      ownerColumn = await getOwnerColumn(supabase, "businesses");
    } catch (ownerColumnError) {
      log.warn("Business owner-column probe failed during create", {
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
    if (!hasAcceptedPostTerms(data.termsAccepted)) {
      return NextResponse.json(
        { error: "Posting terms must be accepted before creating a post" },
        { status: 422 }
      );
    }

    // ── Idempotency guard: reject duplicate submissions ──────
    // If the same user submitted a business with the identical name
    // within the last 2 minutes, return the existing business instead
    // of creating a duplicate (protects against network retries).
    {
      const { data: recentDupe } = await applyOwnerFilter(
        supabase
          .from("businesses")
          .select("id")
          .eq("business_name", data.business_name)
          .gte("created_at", new Date(Date.now() - 120_000).toISOString()),
        ownerColumn,
        user.id
      )
        .limit(1)
        .maybeSingle();

      if (recentDupe) {
        log.warn("Duplicate business submission detected", {
          userId: user.id,
          existingId: recentDupe.id,
        });
        return NextResponse.json(
          { success: true, business: { id: recentDupe.id }, deduplicated: true },
          { status: 200 }
        );
      }
    }

    // Tourism businesses belong in the PROMOTIONS_EVENTS marketplace area.
    const effectiveArea: MarketplaceArea =
      data.category === "tourism_hospitality" ? "PROMOTIONS_EVENTS" : AREA;

    const planResult = await getActivePostingPlanOrResponse(supabase, user.id, effectiveArea, log);
    if (planResult.response) {
      return planResult.response;
    }
    const { hasPaidPlan, tier, entitlements: ent } = planResult;
    const postingLimitBypassEnabled = isPostingLimitBypassEnabled();

    // The paid-plan post limit is enforced atomically inside
    // insert_business_with_limit: the per-user advisory lock is held across
    // both the count check and the INSERT, closing the TOCTOU race (#25/M1).
    // -1 skips the check (unlimited plans, bypass mode, and free-post users
    // whose limit is enforced by the free_posts_used ledger).
    const maxAllowedForInsert =
      hasPaidPlan && tier && !postingLimitBypassEnabled ? ent.maxAllowed : -1;

    const mediaLimitBlock = enforcePostingMediaLimits({
      entitlements: ent,
      photoCount: data.gallery_photos?.length ?? 0,
      videoCount: data.cover_video ? 1 : 0,
      photoLabel: "gallery photos",
      videoUnavailableMessage: "Video is not available on your current plan.",
    });
    if (mediaLimitBlock) return mediaLimitBlock;

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

    try {
      await confirmMediaUploads({
        supabase: getAdmin(),
        userId: user.id,
        contentType: "business",
        contentId: freePostContentId,
        urls: [
          data.logo_url,
          data.cover_photo,
          data.cover_video,
          data.video_thumbnail,
          ...(data.gallery_photos ?? []),
        ],
      });
    } catch (mediaError) {
      if (mediaError instanceof MediaUploadConfirmationError) {
        return NextResponse.json({ error: "Invalid media upload" }, { status: 422 });
      }
      throw mediaError;
    }

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
              effectiveArea === "PROMOTIONS_EVENTS"
                ? "You have already used your free post for Tourism & Events. Subscribe to a plan to post more."
                : "You have already used your free post for Mzansi Business. Subscribe to a plan to post more.",
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
      expires_at: getPostExpiryIso({ hasPaidPlan }),
    };

    // Ownership is enforced inside insert_business_with_limit (forced to the
    // authenticated user), so the payload deliberately carries no owner field.
    const { data: insertResult, error: insertError } = await getAdmin().rpc(
      "insert_business_with_limit",
      {
        p_user_id: user.id,
        p_area: effectiveArea,
        p_max_allowed: maxAllowedForInsert,
        p_data: businessPayload,
      }
    );

    const limitRow = insertResult as { limit_reached?: boolean } | null;
    if (!insertError && limitRow?.limit_reached === true) {
      const check = canCreateListing(maxAllowedForInsert, tier as PlanTier, effectiveArea);
      return NextResponse.json(
        { error: "Business limit reached", reason: check.reason },
        { status: 403 }
      );
    }

    const insertedRow = insertResult as { id?: string } | null;
    const business = !insertError && insertedRow?.id ? { id: insertedRow.id } : null;

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

    try {
      await recordPostTermsAcceptance(getAdmin(), {
        userId: user.id,
        area: effectiveArea,
        contentId: business.id,
      });
    } catch (consentError) {
      // Best-effort: the business row already exists, so failing the response
      // here would orphan the create and make client retries duplicate it.
      log.error("Failed to record post terms acceptance", {
        userId: user.id,
        businessId: business.id,
        error: consentError instanceof Error ? consentError.message : "Unknown error",
      });
      try {
        await logAuditEvent({
          actorId: user.id,
          actorRole: "member",
          action: "consent_updated",
          targetType: "business",
          targetId: business.id,
          area: effectiveArea,
          metadata: { termsAcceptanceRecorded: false },
        });
      } catch {
        // non-fatal
      }
    }

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
    /**
     * SERVICE_ROLE_PUBLIC_READ_CHECKLIST:
     * - createAdminClient is used only after query parsing and browse rate limiting.
     * - Public responses must stay limited to live marketplace content.
     * - Owner/contact fields must remain redacted where this list endpoint exposes public data.
     * - Regression coverage lives in service-role-public-read-checklist.test.ts.
     */
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
        // Fallback: manual query, paged so categories beyond the first page
        // are not silently undercounted.
        const businesses: Array<{
          category: string;
          business_name: string | null;
          description: string | null;
        }> = [];
        const batchSize = 1000;
        const maxRows = 10_000;

        for (let from = 0; from < maxRows; from += batchSize) {
          const { data: batch } = await applyVisibleExpiryFilter(
            admin
              .from("businesses")
              .select("category, business_name, description, created_at")
              .eq("status", "live")
              .in("area", ["MZANSI_BUSINESS", "PROMOTIONS_EVENTS"])
          ).range(from, from + batchSize - 1);

          if (!batch || batch.length === 0) {
            break;
          }

          businesses.push(...batch);

          if (batch.length < batchSize) {
            break;
          }
        }

        const categoryCounts: Record<string, number> = {};
        for (const b of businesses) {
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
      let query = applyVisibleExpiryFilter(
        admin.from("businesses").select(selectClause, { count: "exact" }).eq("status", "live")
      );

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
        } else {
          // The search token sanitized to nothing (e.g. "!!!") — force an
          // empty result so it matches the active filter chip instead of
          // silently returning the unfiltered page.
          query = query.eq("id", "00000000-0000-0000-0000-000000000000");
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
