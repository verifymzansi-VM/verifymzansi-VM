import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { businessSchema } from "@/lib/validations/business-unified";
import { getEntitlements } from "@/lib/services/entitlements";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import {
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecord,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import {
  collectMediaUrls,
  diffRemovedMediaUrls,
  queuePublicMediaCleanup,
} from "@/lib/services/media-cleanup";
import type { PlanTier } from "@/types/enums";
import type { BusinessDetails } from "@/types/business-details";

const log = createLogger("BusinessDetail");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type BusinessOwnerRow = {
  id: string;
  status: string;
  owner_id?: string | null;
  seller_id?: string | null;
  logo_url?: string | null;
  cover_photo?: string | null;
  cover_video?: string | null;
  video_thumbnail?: string | null;
  gallery_photos?: string[] | null;
  business_details?: BusinessDetails | null;
};

function getMallPhotoUrls(details: BusinessDetails | null | undefined): string[] {
  return details?.type === "mall_store" ? (details.mall_photos ?? []) : [];
}

/**
 * GET /api/businesses/[id]
 *
 * Get a single business by ID. Public for live businesses.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid business ID" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: business, error } = await admin
      .from("businesses")
      .select(
        "id, owner_id, seller_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, map_directions, phone, whatsapp, email, website, social_links, services_offered, service_areas, business_details, operating_hours, payment_methods_accepted, delivery_options, boost_until, featured_until, published_at, status, area, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (error || !business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const normalizedBusiness = normalizeOwnerRecord(business as BusinessOwnerRow);

    // Only allow public access to live businesses
    if (normalizedBusiness.status !== "live") {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || user.id !== readOwnerId(normalizedBusiness)) {
        return NextResponse.json({ error: "Business not found" }, { status: 404 });
      }
    }

    // Fetch linked promotions
    const { data: promotions } = await admin
      .from("promotions")
      .select(
        "id, title, promotion_type, photos, price_cents, start_date, end_date, boost_until, created_at"
      )
      .eq("business_id", id)
      .eq("status", "live")
      .order("boost_until", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(12);

    // Track view (best-effort)
    admin
      .from("listing_views")
      .insert({
        target_id: id,
        target_type: "business",
      })
      .then(() => {});

    // Strip owner identifiers from public response (POPIA data minimization)
    const { owner_id: _oid, seller_id: _sid, ...publicBusiness } = normalizedBusiness;
    return NextResponse.json({ business: publicBusiness, promotions: promotions ?? [] });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to fetch business" }, { status: 500 });
  }
}

/**
 * PATCH /api/businesses/[id]
 *
 * Update a business. Requires authentication and ownership.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid business ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "businesses");

    // Check ownership
    const { data: rawExisting } = await admin
      .from("businesses")
      .select(
        withOwnerColumn(
          "id, owner_id, status, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, business_details",
          ownerColumn
        )
      )
      .eq("id", id)
      .maybeSingle();
    const existing = rawExisting as BusinessOwnerRow | null;

    if (!existing) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (readOwnerId(existing) !== user.id) {
      return NextResponse.json({ error: "You don't own this business" }, { status: 403 });
    }

    const parsedBody = await parseAndValidateJsonRequest(request, businessSchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Validation failed",
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const data = parsedBody.data;
    const { data: activeEntitlement } = await admin
      .from("entitlements")
      .select("tier")
      .eq("user_id", user.id)
      .eq("area", "MZANSI_BUSINESS")
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const hasPaidPlan = !!activeEntitlement;
    const activeTier = (activeEntitlement?.tier as string) || null;
    const ent =
      hasPaidPlan && activeTier
        ? getEntitlements(activeTier as PlanTier, "MZANSI_BUSINESS")
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
            coverVideoAllowed: false,
          };

    if ((data.gallery_photos?.length ?? 0) > ent.maxPhotos) {
      return NextResponse.json(
        { error: `Maximum ${ent.maxPhotos} gallery photos allowed on your plan` },
        { status: 422 }
      );
    }

    if (data.cover_video && !ent.coverVideoAllowed) {
      return NextResponse.json(
        { error: "Cover video is not available on your current plan." },
        { status: 422 }
      );
    }

    const nextMediaUrls = collectMediaUrls(
      data.logo_url || null,
      data.cover_photo || null,
      data.cover_video || null,
      data.video_thumbnail || null,
      data.gallery_photos || [],
      getMallPhotoUrls(data.business_details)
    );
    const removedMediaUrls = diffRemovedMediaUrls(
      collectMediaUrls(
        existing.logo_url,
        existing.cover_photo,
        existing.cover_video,
        existing.video_thumbnail,
        existing.gallery_photos,
        getMallPhotoUrls(existing.business_details as BusinessDetails | null | undefined)
      ),
      nextMediaUrls
    );

    const updateQuery = applyOwnerFilter(
      admin
        .from("businesses")
        .update({
          business_type: data.business_type,
          business_name: data.business_name,
          slug: data.slug,
          description: data.description,
          category: data.category,
          logo_url: data.logo_url || null,
          cover_photo: data.cover_photo || null,
          cover_video: data.cover_video || null,
          video_thumbnail: data.video_thumbnail || null,
          gallery_photos: data.gallery_photos || [],
          location_province: data.location_province,
          location_city: data.location_city,
          store_number: data.store_number || null,
          map_directions: data.map_directions || null,
          phone: data.phone || null,
          whatsapp: data.whatsapp || null,
          email: data.email || null,
          website: data.website || null,
          social_links: data.social_links || null,
          services_offered: data.services_offered,
          service_areas: data.service_areas || null,
          business_details: data.business_details || null,
          operating_hours: data.operating_hours,
          payment_methods_accepted: data.payment_methods_accepted,
          delivery_options: data.delivery_options,
          // Re-trigger moderation only for live businesses so changed content is reviewed.
          // Draft and rejected businesses keep their current status.
          ...(existing.status === "live" ? { status: "pending_moderation" as const } : {}),
        })
        .eq("id", id),
      ownerColumn,
      user.id
    );

    const { error: updateError } = await updateQuery;

    if (updateError) {
      log.error("Failed to update business", { error: updateError.message });
      return NextResponse.json({ error: "Failed to update business" }, { status: 500 });
    }

    if (removedMediaUrls.length > 0) {
      try {
        await queuePublicMediaCleanup(admin, removedMediaUrls, "business_media_replaced");
      } catch (cleanupError) {
        log.error("Failed to queue replaced business media for cleanup", {
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
          businessId: id,
        });
      }
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_updated",
        targetType: "business",
        targetId: id,
        area: "MZANSI_BUSINESS",
        metadata: { business_name: data.business_name },
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to update business" }, { status: 500 });
  }
}

/**
 * DELETE /api/businesses/[id]
 *
 * Delete a business. Only draft or rejected businesses can be deleted.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid business ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();
    const ownerColumn = await getOwnerColumn(admin, "businesses");

    const { data: rawExisting } = await admin
      .from("businesses")
      .select(
        withOwnerColumn(
          "id, owner_id, status, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, business_details",
          ownerColumn
        )
      )
      .eq("id", id)
      .maybeSingle();
    const existing = rawExisting as BusinessOwnerRow | null;

    if (!existing) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (readOwnerId(existing) !== user.id) {
      return NextResponse.json({ error: "You don't own this business" }, { status: 403 });
    }

    if (!["draft", "rejected"].includes(existing.status)) {
      return NextResponse.json(
        { error: "Only draft or rejected businesses can be deleted" },
        { status: 400 }
      );
    }

    const deleteQuery = applyOwnerFilter(
      admin.from("businesses").delete().eq("id", id),
      ownerColumn,
      user.id
    );

    const { error: deleteError } = await deleteQuery;

    if (deleteError) {
      log.error("Failed to delete business", { error: deleteError.message });
      return NextResponse.json({ error: "Failed to delete business" }, { status: 500 });
    }

    const deletedMediaUrls = collectMediaUrls(
      existing.logo_url,
      existing.cover_photo,
      existing.cover_video,
      existing.video_thumbnail,
      existing.gallery_photos,
      getMallPhotoUrls(existing.business_details as BusinessDetails | null | undefined)
    );

    if (deletedMediaUrls.length > 0) {
      try {
        await queuePublicMediaCleanup(admin, deletedMediaUrls, "business_deleted");
      } catch (cleanupError) {
        log.error("Failed to queue deleted business media for cleanup", {
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
          businessId: id,
        });
      }
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: "listing_deleted",
        targetType: "business",
        targetId: id,
        area: "MZANSI_BUSINESS",
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to delete business" }, { status: 500 });
  }
}
