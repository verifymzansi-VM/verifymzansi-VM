import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { promotionSchema } from "@/lib/validations/promotion";
import { getEntitlements } from "@/lib/services/entitlements";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import type { PlanTier } from "@/types/enums";
import { inferPromotionCategoryKey } from "@/lib/utils/promotion-category";
import {
  collectMediaUrls,
  diffRemovedMediaUrls,
  queuePublicMediaCleanup,
} from "@/lib/services/media-cleanup";
import {
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecord,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("PromotionDetail");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type PromotionOwnerRow = {
  id: string;
  status: string;
  owner_id?: string | null;
  seller_id?: string | null;
  title?: string | null;
  photos?: string[] | null;
  videos?: string[] | null;
  video_thumbnail?: string | null;
  view_count?: number | null;
};

/**
 * GET /api/promotions/[id]
 *
 * Get a single promotion by ID. Public for live promotions.
 * Increments view_count.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid promotion ID" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: promotion, error } = await admin
      .from("promotions")
      .select(
        "id, owner_id, seller_id, business_id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, contact_methods, start_date, end_date, boost_until, featured_until, status, view_count, published_at, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (error || !promotion) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }

    const normalizedPromotion = normalizeOwnerRecord(promotion as PromotionOwnerRow);

    // Only allow public access to live promotions
    if (normalizedPromotion.status !== "live") {
      // Check if the current user is the owner
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || user.id !== readOwnerId(normalizedPromotion)) {
        return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
      }
    }

    // Increment view count atomically (best-effort, non-blocking).
    // Uses raw SQL to avoid read-modify-write race condition.
    admin
      .from("promotions")
      .update({ view_count: (normalizedPromotion.view_count ?? 0) + 1 } as Record<string, unknown>)
      .eq("id", id)
      .then(() => {});

    return NextResponse.json({ promotion: normalizedPromotion });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to fetch promotion" }, { status: 500 });
  }
}

/**
 * PUT /api/promotions/[id]
 *
 * Update a promotion. Requires authentication and ownership.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid promotion ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "promotion:update");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "promotions");

    // Check ownership
    const { data: rawExisting } = await admin
      .from("promotions")
      .select(withOwnerColumn("id, owner_id, status, photos, videos, video_thumbnail", ownerColumn))
      .eq("id", id)
      .maybeSingle();
    const existing = rawExisting as PromotionOwnerRow | null;

    if (!existing) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }

    if (readOwnerId(existing) !== user.id) {
      return NextResponse.json({ error: "You don't own this promotion" }, { status: 403 });
    }

    const parsedBody = await parseAndValidateJsonRequest(request, promotionSchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Validation failed",
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const data = parsedBody.data;
    const categoryKey =
      data.category_key ?? inferPromotionCategoryKey(data.category, data.promotion_type);
    const { data: activeEntitlement } = await admin
      .from("entitlements")
      .select("tier")
      .eq("user_id", user.id)
      .eq("area", "PROMOTIONS_EVENTS")
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasPaidPlan = !!activeEntitlement;
    const activeTier = (activeEntitlement?.tier as string) || null;
    const ent =
      hasPaidPlan && activeTier
        ? getEntitlements(activeTier as PlanTier, "PROMOTIONS_EVENTS")
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          };

    if (data.images.length > ent.maxPhotos) {
      return NextResponse.json(
        { error: `Maximum ${ent.maxPhotos} photos allowed on your plan` },
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

    const removedMediaUrls = diffRemovedMediaUrls(
      collectMediaUrls(existing.photos, existing.videos, existing.video_thumbnail),
      collectMediaUrls(data.images, data.videos, data.video_thumbnail || null)
    );

    const priceCents = data.price_zar != null ? Math.round(data.price_zar * 100) : null;

    const updateQuery = applyOwnerFilter(
      admin
        .from("promotions")
        .update({
          title: data.title,
          description: data.description,
          promotion_type: data.promotion_type,
          category: data.category || null,
          category_key: categoryKey,
          business_id: data.business_id || null,
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
          // Re-trigger moderation on edit so changed content is reviewed
          status: "pending_moderation",
        })
        .eq("id", id),
      ownerColumn,
      user.id
    );

    const { error: updateError } = await updateQuery;

    if (updateError) {
      log.error("Failed to update promotion", { error: updateError.message });
      return NextResponse.json({ error: "Failed to update promotion" }, { status: 500 });
    }

    if (removedMediaUrls.length > 0) {
      try {
        await queuePublicMediaCleanup(admin, removedMediaUrls, "promotion_media_replaced");
      } catch (cleanupError) {
        log.error("Failed to queue replaced promotion media for cleanup", {
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
          promotionId: id,
        });
      }
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_updated",
        targetType: "promotion",
        targetId: id,
        metadata: { title: data.title },
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to update promotion" }, { status: 500 });
  }
}

/**
 * DELETE /api/promotions/[id]
 *
 * Delete a promotion. Only draft or rejected promotions can be deleted.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid promotion ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "promotion:delete");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "promotions");

    const { data: rawExisting } = await admin
      .from("promotions")
      .select(withOwnerColumn("id, owner_id, status, photos, videos, video_thumbnail", ownerColumn))
      .eq("id", id)
      .maybeSingle();
    const existing = rawExisting as PromotionOwnerRow | null;

    if (!existing) {
      return NextResponse.json({ error: "Promotion not found" }, { status: 404 });
    }

    if (readOwnerId(existing) !== user.id) {
      return NextResponse.json({ error: "You don't own this promotion" }, { status: 403 });
    }

    if (!["draft", "rejected"].includes(existing.status)) {
      return NextResponse.json(
        { error: "Only draft or rejected promotions can be deleted" },
        { status: 400 }
      );
    }

    const deleteQuery = applyOwnerFilter(
      admin.from("promotions").delete().eq("id", id),
      ownerColumn,
      user.id
    );

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      log.error("Failed to delete promotion", { error: deleteError.message });
      return NextResponse.json({ error: "Failed to delete promotion" }, { status: 500 });
    }

    const deletedMediaUrls = collectMediaUrls(
      existing.photos,
      existing.videos,
      existing.video_thumbnail
    );

    if (deletedMediaUrls.length > 0) {
      try {
        await queuePublicMediaCleanup(admin, deletedMediaUrls, "promotion_deleted");
      } catch (cleanupError) {
        log.error("Failed to queue deleted promotion media for cleanup", {
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
          promotionId: id,
        });
      }
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_deleted",
        targetType: "promotion",
        targetId: id,
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to delete promotion" }, { status: 500 });
  }
}
