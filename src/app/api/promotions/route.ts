import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { promotionSchema } from "@/lib/validations/promotion";

const log = createLogger("PromotionsCRUD");

/**
 * POST /api/promotions
 *
 * Create a new standalone promotion / advertisement.
 * Requires authenticated, verified seller.
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

    // Check seller profile exists
    const { data: profile } = await admin
      .from("seller_profiles")
      .select("id, seller_verification_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
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

    // Build the promotion row
    const priceCents = data.price_zar != null ? Math.round(data.price_zar * 100) : null;

    const { data: promotion, error: insertError } = await admin
      .from("promotions")
      .insert({
        seller_id: user.id,
        title: data.title,
        description: data.description,
        promotion_type: data.promotion_type,
        category: data.category || null,
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
        status: "live",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError || !promotion) {
      log.error("Failed to create promotion", { error: insertError?.message });
      return NextResponse.json({ error: "Failed to create promotion" }, { status: 500 });
    }

    // Audit (best-effort)
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "seller",
        action: "listing_created",
        targetType: "promotion",
        targetId: promotion.id,
        metadata: { promotion_type: data.promotion_type, title: data.title },
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
    const { searchParams } = request.nextUrl;

    const promotionType = searchParams.get("type");
    const province = searchParams.get("province");
    const city = searchParams.get("city");
    const search = searchParams.get("q");
    const businessId = searchParams.get("business_id");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "24", 10)));
    const offset = (page - 1) * limit;

    let query = admin
      .from("promotions")
      .select(
        "id, seller_id, business_id, title, description, promotion_type, category, photos, videos, video_thumbnail, price_cents, price_negotiable, location_province, location_city, contact_methods, start_date, end_date, boost_until, featured_until, view_count, published_at, created_at",
        { count: "exact" }
      )
      .eq("status", "live");

    if (promotionType) {
      query = query.eq("promotion_type", promotionType);
    }
    if (businessId) {
      query = query.eq("business_id", businessId);
    }
    if (province) {
      query = query.eq("location_province", province);
    }
    if (city) {
      query = query.eq("location_city", city);
    }
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Order: boosted first, then featured, then newest
    query = query
      .order("boost_until", { ascending: false, nullsFirst: false })
      .order("featured_until", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: promotions, count, error } = await query;

    if (error) {
      log.error("Failed to fetch promotions", { error: error.message });
      return NextResponse.json({ error: "Failed to fetch promotions" }, { status: 500 });
    }

    return NextResponse.json({
      promotions: promotions ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to fetch promotions" }, { status: 500 });
  }
}
