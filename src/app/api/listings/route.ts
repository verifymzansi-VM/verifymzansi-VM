import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listingSchema } from "@/lib/validations/listing";
import { logAuditEvent } from "@/lib/services/audit";
import { getEntitlements, canCreateListing } from "@/lib/services/entitlements";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { parseJsonRequest } from "@/lib/utils/api";
import type { MarketplaceArea, PlanTier } from "@/types/enums";

const log = createLogger("ListingCreate");
const AREA: MarketplaceArea = "MZANSI_MARKET";

/**
 * POST /api/listings
 *
 * Server-side listing creation with full validation, auth, ownership,
 * entitlement enforcement, and free-post tracking.
 */
export async function POST(request: NextRequest) {
  try {
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
        { status: 429 }
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
    const admin = createAdminClient();

    // ── Get seller profile ───────────────────────────────────
    const { data: profile } = await admin
      .from("seller_profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    // ── Check entitlement / plan limits ──────────────────────
    // Check if user has a paid entitlement (not expired)
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

    // Check free post availability for unpaid users
    if (!hasPaidPlan) {
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
              "You have already used your free post for Mzansi Market. Subscribe to a plan to post more.",
          },
          { status: 403 }
        );
      }
    }

    if (hasPaidPlan && tier) {
      // Paid plan — check listing count against plan limits
      const { count } = await admin
        .from("listings")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", user.id)
        .neq("status", "rejected");

      const currentCount = count ?? 0;
      const check = canCreateListing(currentCount, tier as PlanTier, AREA);

      if (!check.allowed) {
        return NextResponse.json(
          { error: "Listing limit reached", reason: check.reason },
          { status: 403 }
        );
      }
    }

    // ── Enforce photo/video limits based on plan ─────────────
    const ent =
      hasPaidPlan && tier
        ? getEntitlements(tier as PlanTier, AREA)
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          };

    const rawVideos = Array.isArray((body as Record<string, unknown>).videos)
      ? ((body as Record<string, unknown>).videos as unknown[])
      : [];
    if (rawVideos.some((video) => typeof video !== "string")) {
      return NextResponse.json({ error: "Videos must be an array of URLs" }, { status: 422 });
    }

    if (data.images.length > ent.maxPhotos) {
      return NextResponse.json(
        {
          error: `Maximum ${ent.maxPhotos} photos allowed on your plan`,
        },
        { status: 422 }
      );
    }

    if (rawVideos.length > 0 && !ent.videoAllowed) {
      return NextResponse.json(
        { error: "Video upload is not available on your current plan." },
        { status: 422 }
      );
    }

    if (rawVideos.length > ent.maxVideos) {
      return NextResponse.json(
        { error: `Maximum ${ent.maxVideos} videos allowed on your plan` },
        { status: 422 }
      );
    }

    // ── Prepare listing record ───────────────────────────────
    const priceCents = Math.round(data.price_zar * 100);

    const listingRecord = {
      seller_id: user.id,
      title: data.title,
      description: data.description,
      price_cents: priceCents,
      price_negotiable: data.negotiable,
      category: data.category,
      attributes: "attributes" in data ? data.attributes : {},
      condition: data.condition || null,
      location_province: data.province || null,
      location_city: data.city || null,
      location_suburb: (body as Record<string, unknown>).town || null,
      status: "pending_moderation",
      area: AREA,
      photos: data.images,
      videos: rawVideos,
      video_thumbnail: (body as Record<string, unknown>).videoThumbnail || null,
      contact_methods: (body as Record<string, unknown>).contactMethods || ["call"],
    };

    // ── Insert listing ───────────────────────────────────────
    const { data: newListing, error: insertError } = await admin
      .from("listings")
      .insert(listingRecord)
      .select("id")
      .single();

    if (insertError) {
      log.error("Failed to insert listing", {
        error: insertError.message,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Failed to create listing", details: insertError.message },
        { status: 500 }
      );
    }

    // ── Mark free post as used if no paid entitlement ────────
    if (!hasPaidPlan) {
      const { error: freePostError } = await admin
        .from("free_posts_used")
        .upsert({ user_id: user.id, area: AREA }, { onConflict: "user_id,area" });

      if (freePostError) {
        log.error("Failed to mark free post as used", {
          error: freePostError.message,
          userId: user.id,
        });
        // Don't fail the request — the listing was already created
      }
    }

    // ── Audit log ────────────────────────────────────────────
    await logAuditEvent({
      actorId: user.id,
      actorRole: "seller",
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

    log.info("Listing created", {
      listingId: newListing.id,
      userId: user.id,
      category: data.category,
    });

    return NextResponse.json(
      { id: newListing.id, message: "Listing submitted for review" },
      { status: 201 }
    );
  } catch (err) {
    log.error("Unexpected error in listing creation", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
