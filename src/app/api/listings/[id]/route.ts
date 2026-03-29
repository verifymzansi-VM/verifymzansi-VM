import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listingSchema } from "@/lib/validations/listing";
import { logAuditEvent } from "@/lib/services/audit";
import { getEntitlements } from "@/lib/services/entitlements";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import { parseJsonRequest, parseAndValidateRouteParams } from "@/lib/utils/api";
import {
  collectMediaUrls,
  diffRemovedMediaUrls,
  queuePublicMediaCleanup,
} from "@/lib/services/media-cleanup";
import type { MarketplaceArea, PlanTier } from "@/types/enums";
import {
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";

const log = createLogger("ListingUpdate");
const listingIdParamsSchema = z.object({
  id: uuidSchema,
});
const AREA: MarketplaceArea = "MZANSI_MARKET";
type ListingUpdateRow = {
  id: string;
  status: string;
  area?: MarketplaceArea | null;
  photos?: string[] | null;
  videos?: string[] | null;
  video_thumbnail?: string | null;
  logo_url?: string | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

/**
 * PUT /api/listings/[id]
 *
 * Server-side listing update with full validation, auth, ownership check,
 * and photo/video limit enforcement.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // ── CSRF protection ───────────────────────────────────────
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const parsedParams = parseAndValidateRouteParams(await params, listingIdParamsSchema, {
      validationErrorMessage: "Invalid listing ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id: listingId } = parsedParams.data;

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
      action: "listing_update",
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
    const ownerColumn = await getOwnerColumn(supabase, "listings");

    // ── Check listing exists and user owns it ────────────────
    const { data: rawListing } = await applyOwnerFilter(
      supabase
        .from("listings")
        .select(
          withOwnerColumn(
            "id, owner_id, status, area, photos, videos, video_thumbnail, logo_url",
            ownerColumn
          )
        )
        .eq("id", listingId),
      ownerColumn,
      user.id
    ).maybeSingle();
    const listing = rawListing as ListingUpdateRow | null;

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Defense-in-depth: applyOwnerFilter already scopes results to the current
    // user, so this check should never trigger. Kept as a safety net.
    if (readOwnerId(listing) !== user.id) {
      return NextResponse.json(
        { error: "Forbidden — you do not own this listing" },
        { status: 403 }
      );
    }

    // Prevent editing rejected, expired, or sold listings
    if (listing.status === "rejected") {
      return NextResponse.json(
        { error: "Cannot edit a rejected listing. Use the resubmission flow." },
        { status: 409 }
      );
    }
    if (listing.status === "expired" || listing.status === "sold") {
      return NextResponse.json(
        { error: `Cannot edit a ${listing.status} listing.` },
        { status: 409 }
      );
    }

    // ── Enforce photo/video limits based on plan ─────────────
    // Check if user has a paid entitlement (not expired)
    const { data: activeEntitlement } = await supabase
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
    const activeTier = (activeEntitlement?.tier as string) || null;

    const ent =
      hasPaidPlan && activeTier
        ? getEntitlements(activeTier as PlanTier, AREA)
        : {
            maxPhotos: FREE_POST_CONFIG.maxPhotos,
            maxVideos: FREE_POST_CONFIG.maxVideos,
            videoAllowed: FREE_POST_CONFIG.videoAllowed,
          };

    const videoUrls = data.videos;
    const nextVideoThumbnail = data.videoThumbnail || null;
    const nextLogoUrl = data.logo_url || null;

    if (data.images.length > ent.maxPhotos) {
      return NextResponse.json(
        {
          error: `Maximum ${ent.maxPhotos} photos allowed on your plan`,
        },
        { status: 422 }
      );
    }

    if (videoUrls.length > 0 && !ent.videoAllowed) {
      return NextResponse.json(
        { error: "Video upload is not available on your current plan." },
        { status: 422 }
      );
    }

    if (videoUrls.length > ent.maxVideos) {
      return NextResponse.json(
        { error: `Maximum ${ent.maxVideos} videos allowed on your plan` },
        { status: 422 }
      );
    }

    // ── Prepare update record ────────────────────────────────
    const priceCents = Math.round(data.price_zar * 100);

    const updateRecord = {
      title: data.title,
      description: data.description,
      price_cents: priceCents,
      price_negotiable: data.negotiable,
      category: data.category,
      attributes: "attributes" in data ? data.attributes : {},
      condition: data.condition || null,
      location_province: data.province || null,
      location_city: data.city || null,
      location_suburb: data.town || null,
      photos: data.images,
      videos: videoUrls,
      video_thumbnail: nextVideoThumbnail,
      logo_url: nextLogoUrl,
      contact_methods: data.contactMethods,
      // Re-submit for moderation on edit
      status: listing.status === "live" ? "pending_moderation" : listing.status,
    };
    const removedMediaUrls = diffRemovedMediaUrls(
      collectMediaUrls(listing.photos, listing.videos, listing.video_thumbnail, listing.logo_url),
      collectMediaUrls(updateRecord.photos, videoUrls, nextVideoThumbnail, nextLogoUrl)
    );

    // ── Update listing ───────────────────────────────────────
    const updateQuery = applyOwnerFilter(
      supabase.from("listings").update(updateRecord).eq("id", listingId),
      ownerColumn,
      user.id
    ); // Double-check ownership at DB level

    const { error: updateError } = await updateQuery;

    if (updateError) {
      log.error("Failed to update listing", {
        error: updateError.message,
        listingId,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Failed to update listing", details: updateError.message },
        { status: 500 }
      );
    }

    if (removedMediaUrls.length > 0) {
      try {
        const admin = createAdminClient();
        await queuePublicMediaCleanup(admin, removedMediaUrls, "listing_media_replaced");
      } catch (cleanupError) {
        log.error("Failed to queue replaced listing media for cleanup", {
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
          listingId,
        });
      }
    }

    // ── Audit log ────────────────────────────────────────────
    await logAuditEvent({
      actorId: user.id,
      actorRole: "member",
      action: "listing_updated",
      targetType: "listing",
      targetId: listingId,
      area: AREA,
      metadata: {
        category: data.category,
        priceCents,
        previousStatus: listing.status,
      },
    });

    log.info("Listing updated", {
      listingId,
      userId: user.id,
      category: data.category,
    });

    return NextResponse.json({ id: listingId, message: "Listing updated successfully" });
  } catch (err) {
    log.error("Unexpected error in listing update", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
