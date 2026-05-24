import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listingSchema } from "@/lib/validations/listing";
import { logAuditEvent } from "@/lib/services/audit";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { parseJsonRequest, parseAndValidateRouteParams } from "@/lib/utils/api";
import {
  collectMediaUrls,
  diffRemovedMediaUrls,
  queuePublicMediaCleanup,
} from "@/lib/services/media-cleanup";
import {
  confirmMediaUploads,
  MediaUploadConfirmationError,
} from "@/lib/media/confirm-media-uploads";
import type { MarketplaceArea } from "@/types/enums";
import {
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";
import { createNotification, shouldSendOwnerLifecycleNotifications } from "@/lib/notifications";
import {
  contentEditSubmittedResponse,
  createContentEditRequest,
  editLimitReachedResponse,
  hasPendingContentEdit,
  isEditLimitReached,
} from "@/lib/content-edit-requests";
import {
  enforcePostingMediaLimits,
  getPostingEntitlementsOrResponse,
} from "@/app/api/_lib/posting-entitlements";

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
  media_width?: number | null;
  media_height?: number | null;
  focal_x?: number | null;
  focal_y?: number | null;
  owner_id?: string | null;
  seller_id?: string | null;
  updated_at?: string | null;
  approved_edit_count?: number | null;
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
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
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
    // Extract optimistic-lock token (outside Zod schema — optional for backward compat)
    const expectedUpdatedAt =
      typeof body.expected_updated_at === "string" ? body.expected_updated_at : null;
    const ownerColumn = await getOwnerColumn(supabase, "listings");

    // ── Check listing exists and user owns it ────────────────
    const { data: rawListing } = await applyOwnerFilter(
      supabase
        .from("listings")
        .select(
          withOwnerColumn(
            "id, owner_id, status, area, title, description, price_cents, price_negotiable, category, attributes, condition, location_province, location_city, location_town, location_suburb, location_address, photos, videos, video_thumbnail, logo_url, contact_methods, media_width, media_height, focal_x, focal_y, updated_at, approved_edit_count",
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

    // Rejected listings must remain editable so account holders can make the
    // requested changes before using the explicit resubmission flow.
    if (listing.status === "expired" || listing.status === "sold") {
      return NextResponse.json(
        { error: `Cannot edit a ${listing.status} listing.` },
        { status: 409 }
      );
    }

    const entitlementsResult = await getPostingEntitlementsOrResponse(supabase, user.id, AREA, log);
    if (entitlementsResult.response) {
      return entitlementsResult.response;
    }
    const ent = entitlementsResult.entitlements;

    const videoUrls = data.videos;
    const nextVideoThumbnail = data.videoThumbnail || null;
    const nextLogoUrl = data.logo_url || null;

    const mediaLimitBlock = enforcePostingMediaLimits({
      entitlements: ent,
      photoCount: data.images.length,
      videoCount: videoUrls.length,
    });
    if (mediaLimitBlock) return mediaLimitBlock;

    // ── Prepare update record ────────────────────────────────
    const priceCents = Math.round(+(data.price_zar * 100).toPrecision(12));

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
      location_town: data.town || null,
      location_suburb: data.town || null,
      location_address: data.address || null,
      photos: data.images,
      videos: videoUrls,
      video_thumbnail: nextVideoThumbnail,
      logo_url: nextLogoUrl,
      contact_methods: data.contactMethods,
      media_width:
        data.media_width !== undefined ? data.media_width : (listing.media_width ?? null),
      media_height:
        data.media_height !== undefined ? data.media_height : (listing.media_height ?? null),
      focal_x: data.focal_x ?? listing.focal_x ?? 0.5,
      focal_y: data.focal_y ?? listing.focal_y ?? 0.5,
      // Re-submit for moderation on edit (covers both live and approved listings)
      status: ["live", "approved"].includes(listing.status) ? "pending_moderation" : listing.status,
    };
    const admin = createAdminClient();
    const currentMediaUrls = collectMediaUrls(
      listing.photos,
      listing.videos,
      listing.video_thumbnail,
      listing.logo_url
    );
    const nextMediaUrls = collectMediaUrls(data.images, videoUrls, nextVideoThumbnail, nextLogoUrl);
    const addedMediaUrls = diffRemovedMediaUrls(nextMediaUrls, currentMediaUrls);

    if (listing.status === "live") {
      if (isEditLimitReached(listing.approved_edit_count)) {
        return editLimitReachedResponse();
      }

      try {
        if (await hasPendingContentEdit(admin, "listing", listingId)) {
          return NextResponse.json(
            {
              error: "This listing already has an edit pending admin review.",
              code: "pending_edit_exists",
              pendingEditExists: true,
            },
            { status: 409 }
          );
        }
      } catch (pendingEditError) {
        log.error("Failed to check pending listing edit request", {
          listingId,
          userId: user.id,
          error: pendingEditError instanceof Error ? pendingEditError.message : "Unknown error",
        });
        return NextResponse.json({ error: "Unable to verify edit review status" }, { status: 503 });
      }

      const proposedData = { ...updateRecord, status: "live" };

      try {
        await confirmMediaUploads({
          supabase: admin,
          userId: user.id,
          urls: addedMediaUrls,
          contentType: "listing",
          contentId: listingId,
        });

        const editRequest = await createContentEditRequest({
          supabase: admin,
          targetType: "listing",
          targetId: listingId,
          ownerId: user.id,
          area: AREA,
          proposedData,
          currentSnapshot: listing as unknown as Record<string, unknown>,
        });

        if (editRequest.response) {
          return editRequest.response;
        }
      } catch (editRequestError) {
        if (editRequestError instanceof MediaUploadConfirmationError) {
          return NextResponse.json({ error: "Invalid media upload" }, { status: 422 });
        }

        log.error("Failed to create listing edit request", {
          listingId,
          userId: user.id,
          error: editRequestError instanceof Error ? editRequestError.message : "Unknown error",
        });
        return NextResponse.json({ error: "Failed to submit edit for review" }, { status: 500 });
      }

      try {
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
            pendingReview: true,
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
          type: "warning",
          title: "Listing edit submitted for review",
          message: `\"${data.title}\" will stay live with its current approved details until this edit is approved.`,
          href: "/dashboard/listings",
        });
      }

      return contentEditSubmittedResponse(listingId, listing.approved_edit_count);
    }

    const removedMediaUrls = diffRemovedMediaUrls(currentMediaUrls, nextMediaUrls);

    try {
      await confirmMediaUploads({
        supabase: admin,
        userId: user.id,
        urls: addedMediaUrls,
        contentType: "listing",
        contentId: listingId,
      });
    } catch (mediaError) {
      if (mediaError instanceof MediaUploadConfirmationError) {
        return NextResponse.json({ error: "Invalid media upload" }, { status: 422 });
      }
      throw mediaError;
    }

    // ── Update listing ───────────────────────────────────────
    let updateBuilder = supabase.from("listings").update(updateRecord).eq("id", listingId);
    // Optimistic-lock CAS guard: only update if the row hasn't changed since the client loaded it
    if (expectedUpdatedAt) {
      updateBuilder = updateBuilder.eq("updated_at", expectedUpdatedAt);
    }
    const updateQuery = applyOwnerFilter(updateBuilder, ownerColumn, user.id).select("id"); // Double-check ownership at DB level; select id to detect 0-row updates

    const { data: updatedRows, error: updateError } = await updateQuery;

    if (updateError) {
      log.error("Failed to update listing", {
        error: updateError.message,
        listingId,
        userId: user.id,
      });
      return NextResponse.json(
        { error: "Failed to update listing", details: "Please try again shortly." },
        { status: 500 }
      );
    }

    // If CAS guard was active and no rows were updated, listing was modified concurrently
    if (expectedUpdatedAt && (!updatedRows || updatedRows.length === 0)) {
      return NextResponse.json(
        {
          error: "Conflict",
          details: "This listing was modified by another session. Please reload and try again.",
        },
        { status: 409 }
      );
    }

    if (removedMediaUrls.length > 0) {
      try {
        await queuePublicMediaCleanup(admin, removedMediaUrls, "listing_media_replaced");
      } catch (cleanupError) {
        log.error("Failed to queue replaced listing media for cleanup", {
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
          listingId,
        });
      }
    }

    // ── Audit log (best-effort) ────────────────────────────────
    try {
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
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    log.info("Listing updated", {
      listingId,
      userId: user.id,
      category: data.category,
    });

    if (shouldSendOwnerLifecycleNotifications()) {
      const movedBackToReview =
        updateRecord.status === "pending_moderation" &&
        ["live", "approved"].includes(listing.status);
      void createNotification({
        userId: user.id,
        type: movedBackToReview ? "warning" : "info",
        title: movedBackToReview ? "Listing moved to review" : "Listing updated",
        message: movedBackToReview
          ? `\"${data.title}\" was updated and is now pending moderation.`
          : `\"${data.title}\" was updated successfully.`,
        href: "/dashboard/listings",
      });
    }

    return NextResponse.json({ id: listingId, message: "Listing updated successfully" });
  } catch (err) {
    log.error("Unexpected error in listing update", {
      error: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
