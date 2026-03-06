import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { businessSchema } from "@/lib/validations/business-unified";
import { getEntitlements } from "@/lib/services/entitlements";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import type { PlanTier } from "@/types/enums";

const log = createLogger("BusinessDetail");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    // Only allow public access to live businesses
    if (business.status !== "live") {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user || user.id !== business.seller_id) {
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

    return NextResponse.json({ business, promotions: promotions ?? [] });
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

    // Check ownership
    const { data: existing } = await admin
      .from("businesses")
      .select("id, seller_id, status")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (existing.seller_id !== user.id) {
      return NextResponse.json({ error: "You don't own this business" }, { status: 403 });
    }

    // Parse and validate body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = businessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;
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

    const { error: updateError } = await admin
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
        mall_id: data.mall_id || null,
        map_directions: data.map_directions || null,
        phone: data.phone || null,
        whatsapp: data.whatsapp || null,
        email: data.email || null,
        website: data.website || null,
        social_links: data.social_links || null,
        services_offered: data.services_offered,
        service_areas: data.service_areas || null,
        operating_hours: data.operating_hours,
        payment_methods_accepted: data.payment_methods_accepted,
        delivery_options: data.delivery_options,
        // Re-trigger moderation on edit so changed content is reviewed
        status: "pending_moderation",
      })
      .eq("id", id)
      .eq("seller_id", user.id);

    if (updateError) {
      log.error("Failed to update business", { error: updateError.message });
      return NextResponse.json({ error: "Failed to update business" }, { status: 500 });
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "seller",
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

    const { data: existing } = await admin
      .from("businesses")
      .select("id, seller_id, status")
      .eq("id", id)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (existing.seller_id !== user.id) {
      return NextResponse.json({ error: "You don't own this business" }, { status: 403 });
    }

    if (!["draft", "rejected"].includes(existing.status)) {
      return NextResponse.json(
        { error: "Only draft or rejected businesses can be deleted" },
        { status: 400 }
      );
    }

    const { error: deleteError } = await admin
      .from("businesses")
      .delete()
      .eq("id", id)
      .eq("seller_id", user.id);

    if (deleteError) {
      log.error("Failed to delete business", { error: deleteError.message });
      return NextResponse.json({ error: "Failed to delete business" }, { status: 500 });
    }

    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "seller",
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
