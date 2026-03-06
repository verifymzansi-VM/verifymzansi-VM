import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { businessSchema } from "@/lib/validations/business-unified";

const log = createLogger("BusinessesCRUD");

/**
 * POST /api/businesses
 *
 * Create a new Mzansi Business listing.
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

    const parsed = businessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const { data: business, error: insertError } = await admin
      .from("businesses")
      .insert({
        seller_id: user.id,
        area: "MZANSI_BUSINESS",
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
        status: "pending_moderation",
      })
      .select("id")
      .single();

    if (insertError || !business) {
      log.error("Failed to create business", { error: insertError?.message });
      return NextResponse.json({ error: "Failed to create business" }, { status: 500 });
    }

    // Audit (best-effort)
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "seller",
        action: "listing_created",
        targetType: "business",
        targetId: business.id,
        area: "MZANSI_BUSINESS",
        metadata: { business_type: data.business_type, business_name: data.business_name },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    return NextResponse.json({ success: true, business: { id: business.id } }, { status: 201 });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
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
    const admin = createAdminClient();
    const { searchParams } = request.nextUrl;

    // Category counts mode — for auto-hiding empty categories
    if (searchParams.get("categories_only") === "true") {
      const { data: counts, error } = await admin.rpc("get_business_category_counts");

      if (error) {
        // Fallback: manual query
        const { data: businesses } = await admin
          .from("businesses")
          .select("category")
          .eq("status", "live");

        const categoryCounts: Record<string, number> = {};
        for (const b of businesses ?? []) {
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
    const mine = searchParams.get("mine") === "true";
    if (mine) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const mineLimit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
      const { data: myBusinesses } = await admin
        .from("businesses")
        .select("id, business_name, business_type, category, status, created_at")
        .eq("seller_id", user.id)
        .order("created_at", { ascending: false })
        .limit(mineLimit);

      return NextResponse.json({ businesses: myBusinesses ?? [] });
    }

    const businessType = searchParams.get("type");
    const category = searchParams.get("category");
    const province = searchParams.get("province");
    const city = searchParams.get("city");
    const search = searchParams.get("q");
    const mallId = searchParams.get("mall");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "24", 10)));
    const offset = (page - 1) * limit;

    const primarySelect =
      "id, seller_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, store_number, mall_id, phone, whatsapp, email, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, featured_until, published_at, created_at";
    const fallbackSelect =
      "id, seller_id, business_type, business_name, slug, description, category, logo_url, cover_photo, cover_video, video_thumbnail, location_province, location_city, store_number, mall_id, phone, whatsapp, email, website, services_offered, service_areas, operating_hours, payment_methods_accepted, delivery_options, boost_until, featured_until, published_at, created_at";

    const buildQuery = (selectClause: string) => {
      let query = admin
        .from("businesses")
        .select(selectClause, { count: "exact" })
        .eq("status", "live")
        .eq("area", "MZANSI_BUSINESS");

      if (businessType) {
        query = query.eq("business_type", businessType);
      }
      if (category) {
        query = query.eq("category", category);
      }
      if (province) {
        query = query.eq("location_province", province);
      }
      if (city) {
        query = query.eq("location_city", city);
      }
      if (mallId) {
        query = query.eq("mall_id", mallId);
      }
      if (search) {
        // Escape PostgREST special characters to prevent filter injection
        const safeSearch = search.replace(/[,.()\\/]/g, "");
        if (safeSearch) {
          query = query.or(`business_name.ilike.%${safeSearch}%,description.ilike.%${safeSearch}%`);
        }
      }

      return query
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("featured_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
    };

    const primaryResult = await buildQuery(primarySelect);
    let businesses = (primaryResult.data ?? []) as unknown[];
    let count = primaryResult.count;
    let error = primaryResult.error;

    if (error?.message?.includes("gallery_photos")) {
      const fallbackResult = await buildQuery(fallbackSelect);
      businesses = ((fallbackResult.data ?? []) as unknown[]).map((business) => ({
        ...(business as Record<string, unknown>),
        gallery_photos: null,
      }));
      count = fallbackResult.count;
      error = fallbackResult.error;
    }

    if (error) {
      log.error("Failed to fetch businesses", { error: error.message });
      return NextResponse.json({ error: "Failed to fetch businesses" }, { status: 500 });
    }

    return NextResponse.json({
      businesses: businesses ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "Unknown error" });
    return NextResponse.json({ error: "Failed to fetch businesses" }, { status: 500 });
  }
}
