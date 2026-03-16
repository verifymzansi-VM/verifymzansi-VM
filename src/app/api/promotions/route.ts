import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { promotionSchema } from "@/lib/validations/promotion";
import { getEntitlements, canCreateListing } from "@/lib/services/entitlements";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { isPostingLimitBypassEnabled } from "@/lib/utils/posting-limit-bypass";
import {
  type MarketplaceArea,
  type PlanTier,
  type PromotionEventState,
  type PromotionType,
} from "@/types/enums";
import { inferPromotionCategoryKey } from "@/lib/utils/promotion-category";
import { normalizeBusinessCategoryParam } from "@/lib/utils/marketplace-query";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import {
  ACCOUNT_PROFILE_NOT_FOUND_ERROR,
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecords,
  readAccountVerificationStatus,
  withOwnerColumn,
  withOwnerField,
} from "@/lib/account/compat";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { createVerificationRequiredPayload, isVerifiedMember } from "@/app/post/_lib/post-access";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";

const log = createLogger("PromotionsCRUD");
const AREA: MarketplaceArea = "PROMOTIONS_EVENTS";

type PromotionQueryOps = {
  eq: (column: string, value: unknown) => PromotionQueryOps;
  gt: (column: string, value: string) => PromotionQueryOps;
  lt: (column: string, value: string) => PromotionQueryOps;
  or: (filters: string) => PromotionQueryOps;
};

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
  published_at?: string | null;
  created_at: string;
};

function normalizeEventStateParam(value: string | null): PromotionEventState | null {
  if (value === "upcoming" || value === "ongoing" || value === "ended") {
    return value;
  }
  return null;
}

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

/**
 * POST /api/promotions
 *
 * Create a new standalone promotion / advertisement.
 * Requires an authenticated, verified account with a valid entitlement or free post.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "promotions");
    const ip = getClientIp(request);
    const rl = await checkRateLimit({
      key: user.id,
      action: "promotion_create",
      deviceId: ip,
    });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later.", retryAfter: rl.retryAfter },
        { status: 429 }
      );
    }

    // Check account profile exists
    const verification = await resolveAccountVerification(admin, user.id);
    const profile = verification.profile;

    if (!profile) {
      return NextResponse.json({ error: ACCOUNT_PROFILE_NOT_FOUND_ERROR }, { status: 404 });
    }

    if (!isVerifiedMember(verification.accountVerificationStatus)) {
      return NextResponse.json(createVerificationRequiredPayload(AREA), { status: 403 });
    }

    // ── Check entitlement / plan limits ──────────────────────
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
              "You have already used your free post for Promotions & Events. Subscribe to a plan to post more.",
          },
          { status: 403 }
        );
      }
    }

    if (hasPaidPlan && tier && !postingLimitBypassEnabled) {
      // Paid plan — check promotion count against plan limits
      const countQuery = applyOwnerFilter(
        admin
          .from("promotions")
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
          { error: "Promotion limit reached", reason: check.reason },
          { status: 403 }
        );
      }
    }

    // Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = promotionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const categoryKey =
      data.category_key ?? inferPromotionCategoryKey(data.category, data.promotion_type);

    // ── Enforce photo/video limits based on plan ─────────────
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

    // Build the promotion row
    const priceCents = data.price_zar != null ? Math.round(data.price_zar * 100) : null;

    const { data: promotion, error: insertError } = await admin
      .from("promotions")
      .insert(
        withOwnerField(
          {
            title: data.title,
            description: data.description,
            promotion_type: data.promotion_type,
            category: data.category || null,
            category_key: categoryKey,
            photos: data.images,
            videos: data.videos,
            video_thumbnail: data.video_thumbnail || null,
            price_cents: priceCents,
            price_negotiable: data.negotiable,
            location_province: data.province,
            location_city: data.city,
            contact_methods: data.contact_methods,
            start_date: data.start_date || null,
            end_date: data.end_date || null,
            business_id: data.business_id || null,
            status: "pending_moderation",
          },
          ownerColumn,
          user.id
        )
      )
      .select("id")
      .single();

    if (insertError || !promotion) {
      log.error("Failed to create promotion", { error: insertError?.message });
      return NextResponse.json({ error: "Failed to create promotion" }, { status: 500 });
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
    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "promotions");
    const { searchParams } = request.nextUrl;

    const promotionType = searchParams.get("type");
    const categoryKey = normalizeBusinessCategoryParam(searchParams.get("category"));
    const province = searchParams.get("province");
    const city = searchParams.get("city");
    const search = searchParams.get("q");
    const businessId = searchParams.get("business_id");
    const eventState = normalizeEventStateParam(searchParams.get("event_state"));
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "24", 10)));
    const offset = (page - 1) * limit;
    const nowIso = new Date().toISOString();

    const buildQuery = (selectClause: string) => {
      let query = admin
        .from("promotions")
        .select(selectClause, { count: "exact" })
        .eq("status", "live")
        .or(`end_date.is.null,end_date.gte.${nowIso}`)
        .not("title", "ilike", "%seed%")
        .not("title", "ilike", "%[seed]%")
        .not("title", "ilike", "%demo%")
        .not("title", "ilike", "%sample%");

      if (promotionType) {
        query = query.eq("promotion_type", promotionType);
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
        const safeSearch = search
          .replace(/[,.()\\/]/g, "")
          .replace(/%/g, "\\%")
          .replace(/_/g, "\\_");
        if (safeSearch) {
          query = query.or(`title.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`);
        }
      }
      if (eventState) {
        query = applyEventStateFilter(query, eventState, nowIso);
      }

      return query
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("featured_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
    };

    const primarySelect = withOwnerColumn(
      "id, owner_id, business_id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, contact_methods, start_date, end_date, boost_until, featured_until, view_count, published_at, created_at",
      ownerColumn
    );
    const fallbackWithoutCategoryKey = withOwnerColumn(
      "id, owner_id, business_id, title, description, promotion_type, category, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, contact_methods, start_date, end_date, boost_until, featured_until, view_count, published_at, created_at",
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
      return NextResponse.json({ error: "Failed to fetch promotions" }, { status: 500 });
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
      ? await admin.from("businesses").select("id, business_name").in("id", businessIds)
      : { data: [] };

    const serializedAccountProfiles =
      accountProfiles?.map((accountProfile) => ({
        user_id: accountProfile.user_id,
        display_name: accountProfile.display_name,
        trust: computeTrustLevel(readAccountVerificationStatus(accountProfile)),
      })) ?? [];

    return NextResponse.json({
      promotions: filteredPromotions,
      accountProfiles: serializedAccountProfiles,
      sellers: serializedAccountProfiles,
      businesses: businesses ?? [],
      total: Math.max(0, (count ?? filteredPromotions.length) - removedCount),
      page,
      limit,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to fetch promotions" }, { status: 500 });
  }
}
