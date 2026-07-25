import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { promotionSchema } from "@/lib/validations/promotion";
import { canCreateListing } from "@/lib/services/entitlements";
import { checkLocalRateLimit, checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { isPostingLimitBypassEnabled } from "@/lib/utils/posting-limit-bypass";
import {
  type MarketplaceArea,
  type PlanTier,
  type PromotionEventState,
  type PromotionType,
} from "@/types/enums";
import { inferPromotionCategoryKey } from "@/lib/utils/promotion-category";
import {
  createNotification,
  notifyStaffForAdminEvent,
  shouldSendOwnerLifecycleNotifications,
} from "@/lib/notifications";
import {
  getStoredPromotionTypesForFilter,
  parsePromotionFilterType,
} from "@/lib/promotions/type-taxonomy";
import { normalizeBusinessCategoryParam } from "@/lib/utils/marketplace-query";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { EVENT_TYPES } from "@/lib/constants/categories";
import {
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecords,
  readAccountVerificationStatus,
  withOwnerColumn,
  type OwnerColumn,
} from "@/lib/account/compat";
import { userOwnsBusiness } from "@/lib/account/owned-business";
import { enforceVerifiedPostingAccess } from "@/app/api/_lib/verified-posting-access";
import {
  enforcePostingMediaLimits,
  getActivePostingPlanOrResponse,
} from "@/app/api/_lib/posting-entitlements";
import { requirePostingMutationSession } from "@/app/api/_lib/posting-mutation-session";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { parseAndValidateSearchParams, parseJsonRequest } from "@/lib/utils/api";
import {
  createBoundedIntegerSchema,
  optionalTrimmedStringSchema,
  optionalUuidSchema,
} from "@/lib/validations/shared";
import { toFieldErrorMap } from "@/lib/validations/zod-errors";
import { z } from "zod";
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

const log = createLogger("PromotionsCRUD");
const AREA: MarketplaceArea = "PROMOTIONS_EVENTS";

/**
 * Route ownership:
 * - Auth/session/verified posting gates: shared posting API helpers.
 * - Validation: promotionSchema, promotion query schema, and tourism/event taxonomy helpers.
 * - Public reads: service-role boundary owned here; keep live/area/event filters aligned.
 * - Storage/media: confirmMediaUploads owns persisted media reconciliation.
 * - Audit/notifications/free-post ledger: best-effort side effects after content state changes.
 */

type PromotionQueryOps = {
  eq: (column: string, value: unknown) => PromotionQueryOps;
  gt: (column: string, value: string) => PromotionQueryOps;
  lt: (column: string, value: string) => PromotionQueryOps;
  in: (column: string, values: unknown[]) => PromotionQueryOps;
  or: (filters: string) => PromotionQueryOps;
};

type PromotionInsertErrorLike = {
  code?: string | null;
  message?: string | null;
} | null;

type PromotionCompatField =
  | "business_id"
  | "category_key"
  | "event_details"
  | "expires_at"
  | "focal_x"
  | "focal_y"
  | "location_address"
  | "location_town"
  | "logo_url"
  | "media_height"
  | "media_width";

const PROMOTION_INSERT_COMPAT_FIELDS: readonly PromotionCompatField[] = [
  "business_id",
  "category_key",
  "event_details",
  "expires_at",
  "focal_x",
  "focal_y",
  "location_address",
  "location_town",
  "logo_url",
  "media_height",
  "media_width",
];

type PromotionResultRow = {
  id: string;
  owner_id?: string | null;
  seller_id?: string | null;
  business_id?: string | null;
  title: string | null;
  description?: string | null;
  promotion_type: string;
  category?: string | null;
  category_key?: string | null;
  photos?: string[] | null;
  videos?: string[] | null;
  video_thumbnail?: string | null;
  price_cents?: number | null;
  price_negotiable?: boolean;
  location_province?: string;
  location_city?: string;
  contact_methods?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  boost_until?: string | null;
  featured_until?: string | null;
  view_count?: number | null;
  media_width?: number | null;
  media_height?: number | null;
  focal_x?: number | null;
  focal_y?: number | null;
  published_at?: string | null;
  created_at: string;
  event_details?: Record<string, unknown> | null;
};

function normalizeEventStateParam(value: string | null): PromotionEventState | null {
  if (value === "upcoming" || value === "ongoing" || value === "ended") {
    return value;
  }
  return null;
}

const promotionsQuerySchema = z.object({
  type: optionalTrimmedStringSchema,
  category: optionalTrimmedStringSchema,
  event_type: optionalTrimmedStringSchema.refine(
    (v) => !v || EVENT_TYPES.some((t) => t.value === v),
    { message: "Invalid event_type value" }
  ),
  province: optionalTrimmedStringSchema,
  city: optionalTrimmedStringSchema,
  q: optionalTrimmedStringSchema,
  business_id: optionalUuidSchema,
  event_state: optionalTrimmedStringSchema,
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

function applyEventStateFilter<T>(query: T, eventState: PromotionEventState, nowIso: string): T {
  const builder = query as T & PromotionQueryOps;

  switch (eventState) {
    case "upcoming":
      return builder.eq("promotion_type", "event").gt("start_date", nowIso) as T;
    case "ended":
      return builder.eq("promotion_type", "event").lt("end_date", nowIso) as T;
    case "ongoing":
      return builder
        .eq("promotion_type", "event")
        .or(
          [
            `and(start_date.lte.${nowIso},end_date.gte.${nowIso})`,
            `and(start_date.is.null,end_date.gte.${nowIso})`,
            `and(start_date.lte.${nowIso},end_date.is.null)`,
            "and(start_date.is.null,end_date.is.null)",
          ].join(",")
        ) as T;
    default:
      return query;
  }
}

function isPlaceholderPromotion(promotion: { title: string | null; description?: string | null }) {
  return isPlaceholderMarketplaceContent(promotion.title, promotion.description);
}

function canRetryPromotionInsertForCompat(
  error: PromotionInsertErrorLike,
  omittedFields: readonly PromotionCompatField[]
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

function omitPromotionCompatFields<T extends Record<string, unknown>>(
  record: T,
  omittedFields: readonly PromotionCompatField[]
) {
  const next = { ...record };
  for (const field of omittedFields) {
    delete next[field];
  }
  return next;
}

/**
 * POST /api/promotions
 *
 * Create a new standalone promotion / advertisement.
 * Requires an authenticated, verified account with a valid entitlement or free post.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requirePostingMutationSession(request, log);
    if (session.response) return session.response;
    const { supabase, user, getAdmin } = session;

    const ip = getClientIp(request);
    const rl = await checkRateLimit({
      key: user.id,
      action: "promotion_create",
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
      ownerColumn = await getOwnerColumn(supabase, "promotions");
    } catch (ownerColumnError) {
      log.warn("Promotion owner-column probe failed during create", {
        error: ownerColumnError instanceof Error ? ownerColumnError.message : "Unknown error",
        userId: user.id,
      });
      return NextResponse.json(
        {
          error: "Service temporarily unavailable",
          detail: "Promotion ownership metadata is unavailable. Please retry shortly.",
        },
        { status: 503 }
      );
    }

    const accessBlock = await enforceVerifiedPostingAccess(supabase, user.id, AREA);
    if (accessBlock) {
      return accessBlock;
    }

    const planResult = await getActivePostingPlanOrResponse(supabase, user.id, AREA, log);
    if (planResult.response) {
      return planResult.response;
    }
    const { hasPaidPlan, tier, entitlements: ent } = planResult;
    const postingLimitBypassEnabled = isPostingLimitBypassEnabled();

    const body = await parseJsonRequest(request);
    if (body === null) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = promotionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: toFieldErrorMap(parsed.error) },
        { status: 400 }
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
    // If the same user submitted a post with the identical title
    // within the last 2 minutes, return the existing post instead
    // of creating a duplicate (protects against network retries).
    {
      const { data: recentDupe } = await applyOwnerFilter(
        supabase
          .from("promotions")
          .select("id")
          .eq("title", data.title)
          .gte("created_at", new Date(Date.now() - 120_000).toISOString()),
        ownerColumn,
        user.id
      )
        .limit(1)
        .maybeSingle();

      if (recentDupe) {
        log.warn("Duplicate promotion submission detected", {
          userId: user.id,
          existingId: recentDupe.id,
        });
        return NextResponse.json(
          { success: true, promotion: { id: recentDupe.id }, deduplicated: true },
          { status: 200 }
        );
      }
    }

    const categoryKey =
      data.category_key ?? inferPromotionCategoryKey(data.category, data.promotion_type);

    if (data.business_id) {
      const ownsBusiness = await userOwnsBusiness(supabase, user.id, data.business_id);
      if (!ownsBusiness) {
        return NextResponse.json({ error: "Linked business not found" }, { status: 404 });
      }
    }

    const mediaLimitBlock = enforcePostingMediaLimits({
      entitlements: ent,
      photoCount: data.images.length,
      videoCount: data.videos.length,
    });
    if (mediaLimitBlock) return mediaLimitBlock;

    // The paid-plan post limit is enforced atomically inside
    // insert_promotion_with_limit: the per-user advisory lock is held across
    // both the count check and the INSERT, closing the TOCTOU race (#25/M1).
    // -1 skips the check (unlimited plans, bypass mode, and free-post users
    // whose limit is enforced by the free_posts_used ledger).
    const maxAllowedForInsert =
      hasPaidPlan && tier && !postingLimitBypassEnabled ? ent.maxAllowed : -1;

    const freePostContentId = crypto.randomUUID();
    let freePostClaimed = false;

    try {
      await confirmMediaUploads({
        supabase: getAdmin(),
        userId: user.id,
        contentType: "promotion",
        contentId: freePostContentId,
        urls: [...data.images, ...data.videos, data.video_thumbnail, data.logo_url],
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
              "You have already used your free post for Tourism & Events. Subscribe to a plan to post more.",
            upgradeUrl: "/billing",
          },
          { status: 403 }
        );
      }
    }

    // Build the promotion row
    const priceCents =
      data.price_zar != null ? Math.round(+(data.price_zar * 100).toPrecision(12)) : null;
    // Ownership is enforced inside insert_promotion_with_limit (forced to the
    // authenticated user), so the payload deliberately carries no owner field.
    const promotionRecord = {
      id: freePostContentId,
      title: data.title,
      description: data.description,
      promotion_type: data.promotion_type,
      category: data.category || null,
      category_key: categoryKey,
      photos: data.images,
      videos: data.videos,
      video_thumbnail: data.video_thumbnail || null,
      media_width: data.media_width ?? null,
      media_height: data.media_height ?? null,
      focal_x: data.focal_x ?? 0.5,
      focal_y: data.focal_y ?? 0.5,
      price_cents: priceCents,
      price_negotiable: data.negotiable,
      location_province: data.province,
      location_city: data.city,
      location_town: data.location_town || null,
      location_address: data.location_address || null,
      contact_methods: data.contact_methods,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      business_id: data.business_id || null,
      logo_url: data.logo_url || null,
      event_details: data.event_details ?? null,
      status: "pending_moderation",
      expires_at: getPostExpiryIso({ hasPaidPlan }),
    };

    let promotion: { id: string } | null = null;
    let insertError: PromotionInsertErrorLike = null;
    let limitReached = false;
    const insertAttempts = [[], PROMOTION_INSERT_COMPAT_FIELDS] as const;

    for (let attemptIndex = 0; attemptIndex < insertAttempts.length; attemptIndex += 1) {
      const omittedFields = insertAttempts[attemptIndex];
      const insertPayload = omitPromotionCompatFields(promotionRecord, omittedFields);
      const { data: rpcData, error: rpcError } = await getAdmin().rpc(
        "insert_promotion_with_limit",
        {
          p_user_id: user.id,
          p_area: AREA,
          p_max_allowed: maxAllowedForInsert,
          p_data: insertPayload,
        }
      );

      const limitRow = rpcData as { limit_reached?: boolean } | null;
      if (!rpcError && limitRow?.limit_reached === true) {
        limitReached = true;
        break;
      }

      const insertedRow = rpcData as { id?: string } | null;
      promotion = !rpcError && insertedRow?.id ? { id: insertedRow.id } : null;
      insertError = rpcError;

      if (!insertError && promotion) {
        break;
      }

      const nextOmittedFields = insertAttempts[attemptIndex + 1];
      if (!nextOmittedFields) {
        break;
      }

      if (!canRetryPromotionInsertForCompat(insertError, nextOmittedFields)) {
        break;
      }

      log.warn("Retrying promotion insert with compatibility payload", {
        userId: user.id,
        error: insertError?.message,
        omittedFields: nextOmittedFields,
      });
    }

    if (limitReached) {
      const check = canCreateListing(maxAllowedForInsert, tier as PlanTier, AREA);
      return NextResponse.json(
        { error: "Promotion limit reached", reason: check.reason },
        { status: 403 }
      );
    }

    if (insertError || !promotion) {
      log.error("Failed to create promotion", { error: insertError?.message });
      if (freePostClaimed) {
        try {
          await releaseFreePostSlot(getAdmin(), {
            userId: user.id,
            area: AREA,
            contentId: freePostContentId,
            reason: "create_failed",
          });
        } catch (cleanupErr) {
          log.error("Failed to clean up free_posts_used after promotion insert failure", {
            error: cleanupErr instanceof Error ? cleanupErr.message : "Unknown error",
            userId: user.id,
          });
        }
      }
      return NextResponse.json({ error: "Failed to create promotion" }, { status: 500 });
    }

    try {
      await recordPostTermsAcceptance(getAdmin(), {
        userId: user.id,
        area: AREA,
        contentId: promotion.id,
      });
    } catch (consentError) {
      // Best-effort: the promotion row already exists, so failing the response
      // here would orphan the create and make client retries duplicate it.
      log.error("Failed to record post terms acceptance", {
        userId: user.id,
        promotionId: promotion.id,
        error: consentError instanceof Error ? consentError.message : "Unknown error",
      });
      try {
        await logAuditEvent({
          actorId: user.id,
          actorRole: "member",
          action: "consent_updated",
          targetType: "promotion",
          targetId: promotion.id,
          area: AREA,
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
        targetType: "promotion",
        targetId: promotion.id,
        area: AREA,
        metadata: {
          promotion_type: data.promotion_type,
          title: data.title,
          hasPaidPlan,
          tier,
        },
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
        title: "Tourism & Event post submitted",
        message: `\"${data.title}\" was submitted for review.`,
        href: "/dashboard/tourism-events",
      });
    }

    void notifyStaffForAdminEvent({
      capability: "queue:view",
      title: "New tourism or event submission",
      message: `\"${data.title}\" is waiting in the moderation queue.`,
      href: "/admin/tourism-events",
      excludeUserId: user.id,
    });

    return NextResponse.json({ success: true, promotion: { id: promotion.id } }, { status: 201 });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to create promotion" }, { status: 500 });
  }
}

/**
 * GET /api/promotions
 *
 * List live promotions with optional filters.
 * Public endpoint — no auth required.
 */
export async function GET(request: NextRequest) {
  try {
    /**
     * SERVICE_ROLE_PUBLIC_READ_CHECKLIST:
     * - createAdminClient is used only after browse rate limiting.
     * - Public responses must stay limited to live Tourism & Events content.
     * - Placeholder/demo rows are filtered before returning public results.
     * - Regression coverage lives in service-role-public-read-checklist.test.ts.
     */
    // Rate limit public reads by IP (local-only — external worker has wrong
    // limits for read actions; 120 req/min is generous for normal browsing).
    const ip = getClientIp(request) || "unknown";
    const rl = checkLocalRateLimit(ip, "promotions:read", 120);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    let userId: string | null = null;

    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      userId = user?.id ?? null;
    } catch {}

    const viewerKey = buildViewerKey(
      request.cookies?.get?.(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null,
      userId
    );
    let ownerColumn: OwnerColumn;
    try {
      ownerColumn = await getOwnerColumn(admin, "promotions");
    } catch (ownerColumnError) {
      log.warn("Promotions owner-column probe failed", {
        error: ownerColumnError instanceof Error ? ownerColumnError.message : "Unknown error",
      });
      return NextResponse.json(
        {
          error: "Marketplace temporarily unavailable",
          detail: "Promotion ownership metadata is unavailable. Please retry shortly.",
        },
        { status: 503 }
      );
    }
    const parsedQuery = parseAndValidateSearchParams(
      request.nextUrl.searchParams,
      promotionsQuerySchema,
      {
        validationErrorMessage: "Invalid promotions query",
      }
    );
    if (!parsedQuery.success) {
      return parsedQuery.response;
    }

    const query = parsedQuery.data;
    const promotionType = query.type ? parsePromotionFilterType(query.type) : "event";
    if (query.type && !promotionType) {
      return NextResponse.json({ error: "Invalid promotion type" }, { status: 400 });
    }

    const categoryKey = query.category ? normalizeBusinessCategoryParam(query.category) : undefined;
    if (query.category && !categoryKey) {
      return NextResponse.json({ error: "Invalid promotion category" }, { status: 400 });
    }

    const province = query.province;
    const city = query.city;
    const search = query.q;
    const businessId = query.business_id;
    const eventState = normalizeEventStateParam(query.event_state ?? null);
    if (query.event_state && !eventState) {
      return NextResponse.json({ error: "Invalid event_state" }, { status: 400 });
    }
    const eventTypeFilter = query.event_type ?? undefined;
    const page = query.page;
    const limit = query.limit;
    const offset = (page - 1) * limit;
    const nowIso = new Date().toISOString();

    const buildQuery = (selectClause: string) => {
      let query = applyVisibleExpiryFilter(
        admin.from("promotions").select(selectClause, { count: "exact" }).eq("status", "live"),
        nowIso
      );

      // Skip the "not yet ended" base filter for event_state=ended — PostgREST
      // ANDs it with the ended filter (end_date < now), which can never match.
      if (eventState !== "ended") {
        query = query.or(`end_date.is.null,end_date.gte.${nowIso}`);
      }

      if (promotionType) {
        const storedTypes = getStoredPromotionTypesForFilter(promotionType);
        if (storedTypes.length === 1) {
          query = query.eq("promotion_type", storedTypes[0]);
        } else if (storedTypes.length > 1) {
          query = query.in("promotion_type", storedTypes);
        }
      }
      if (businessId) {
        query = query.eq("business_id", businessId);
      }
      if (categoryKey && selectClause.includes("category_key")) {
        query = query.eq("category_key", categoryKey);
      }
      if (province) {
        query = query.eq("location_province", province);
      }
      if (city) {
        query = query.eq("location_city", city);
      }
      if (search) {
        const safeSearch = search.replace(/[^\p{L}\p{N}\s]/gu, "").trim();
        if (safeSearch) {
          query = query.or(`title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`);
        }
      }
      if (eventState) {
        query = applyEventStateFilter(query, eventState, nowIso);
      }
      if (eventTypeFilter) {
        query = query.eq("event_details->>event_type" as never, eventTypeFilter);
      }

      return query
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("featured_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
    };

    const primarySelect = withOwnerColumn(
      "id, owner_id, business_id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, media_width, media_height, logo_url, price_cents, price_negotiable, location_province, location_city, contact_methods, start_date, end_date, event_details, boost_until, featured_until, view_count, focal_x, focal_y, published_at, created_at",
      ownerColumn
    );
    const fallbackWithoutCategoryKey = withOwnerColumn(
      "id, owner_id, business_id, title, description, promotion_type, category, photos, videos, video_thumbnail, media_width, media_height, logo_url, price_cents, price_negotiable, location_province, location_city, contact_methods, start_date, end_date, event_details, boost_until, featured_until, view_count, focal_x, focal_y, published_at, created_at",
      ownerColumn
    );

    const attempts: Array<{ select: string; hasCategoryKey: boolean }> = [
      { select: primarySelect, hasCategoryKey: true },
      { select: fallbackWithoutCategoryKey, hasCategoryKey: false },
    ];

    let promotions: PromotionResultRow[] | null = null;
    let count: number | null = null;
    let error: { message: string } | null = null;
    let selectedAttempt = attempts[0];

    for (const attempt of attempts) {
      const result = await buildQuery(attempt.select);
      if (!result.error) {
        promotions = (result.data ?? []) as unknown as PromotionResultRow[];
        count = result.count;
        error = null;
        selectedAttempt = attempt;
        break;
      }

      error = result.error;

      const message = result.error.message.toLowerCase();
      const canRetry = message.includes("category_key");

      if (!canRetry || attempt === attempts[attempts.length - 1]) {
        break;
      }
    }

    if (error) {
      log.error("Failed to fetch promotions", { error: error.message });
      return NextResponse.json(
        { error: "Failed to fetch Tourism & Events posts" },
        { status: 500 }
      );
    }

    const normalizedPromotions = normalizeOwnerRecords(promotions ?? []).map((promotion) => {
      const normalizedCategoryKey = selectedAttempt.hasCategoryKey
        ? (promotion.category_key ?? null)
        : inferPromotionCategoryKey(
            promotion.category ?? null,
            promotion.promotion_type as PromotionType
          );

      return {
        ...promotion,
        category_key: normalizedCategoryKey,
      };
    });

    const filteredPromotions = normalizedPromotions.filter(
      (promotion) => !isPlaceholderPromotion(promotion)
    );
    const removedCount = (promotions?.length ?? 0) - filteredPromotions.length;
    const promotionIds = filteredPromotions.map((promotion) => promotion.id);
    const [viewCountResult, likeSummaryResult] = await Promise.all([
      getContentViewCountMap(admin, "promotion", promotionIds),
      getContentLikeSummaryMap(admin, "promotion", promotionIds, viewerKey),
    ]);
    const engagementAvailable = viewCountResult.ok && likeSummaryResult.ok;
    if (!engagementAvailable) {
      log.error("Failed to load promotion engagement summary", {
        promotionIds,
        viewErrorCode: viewCountResult.errorCode,
        likeErrorCode: likeSummaryResult.errorCode,
      });
    }
    const accountIds = Array.from(
      new Set(filteredPromotions.map((promotion) => promotion.owner_id).filter(Boolean))
    );
    const businessIds = Array.from(
      new Set(filteredPromotions.map((promotion) => promotion.business_id).filter(Boolean))
    ) as string[];

    const { data: accountProfiles } = accountIds.length
      ? await admin
          .from("account_profiles")
          .select("user_id, display_name, account_verification_status")
          .in("user_id", accountIds)
      : { data: [] };
    const { data: businesses } = businessIds.length
      ? await admin
          .from("businesses")
          .select("id, business_name, logo_url")
          .eq("status", "live")
          .in("id", businessIds)
      : { data: [] };

    const serializedAccountProfiles =
      accountProfiles?.map((accountProfile) => ({
        user_id: accountProfile.user_id,
        display_name: accountProfile.display_name,
        trust: computeTrustLevel(readAccountVerificationStatus(accountProfile)),
      })) ?? [];
    const accountProfileByUserId = new Map(
      serializedAccountProfiles.map((accountProfile) => [accountProfile.user_id, accountProfile])
    );

    const serializedPromotions = filteredPromotions.map((promotion) => {
      const likeSummary = engagementAvailable
        ? likeSummaryResult.data.get(promotion.id)
        : undefined;
      const accountProfile = promotion.owner_id
        ? accountProfileByUserId.get(promotion.owner_id)
        : undefined;

      // Strip owner identifiers from public rows (POPIA data minimization);
      // the embedded account_profile carries the public-safe display fields.
      const { owner_id: _ownerId, seller_id: _sellerId, ...publicPromotion } = promotion;

      return {
        ...publicPromotion,
        account_profile: accountProfile
          ? { display_name: accountProfile.display_name, trust: accountProfile.trust }
          : null,
        view_count:
          typeof promotion.view_count === "number"
            ? promotion.view_count
            : engagementAvailable
              ? (viewCountResult.data.get(promotion.id) ?? null)
              : null,
        like_count: engagementAvailable ? (likeSummary?.likeCount ?? null) : null,
        viewer_has_liked: likeSummary?.viewerHasLiked ?? false,
      };
    });

    return NextResponse.json({
      promotions: serializedPromotions,
      accountProfiles: serializedAccountProfiles,
      sellers: serializedAccountProfiles,
      businesses: businesses ?? [],
      engagement_available: engagementAvailable,
      total: Math.max(0, (count ?? filteredPromotions.length) - removedCount),
      page,
      limit,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to fetch Tourism & Events posts" }, { status: 500 });
  }
}
