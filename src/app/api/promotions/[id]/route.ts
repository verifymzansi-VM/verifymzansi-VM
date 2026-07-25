import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest, parseAndValidateRouteParams } from "@/lib/utils/api";
import { promotionSchema } from "@/lib/validations/promotion";
import { inferPromotionCategoryKey } from "@/lib/utils/promotion-category";
import {
  collectMediaUrls,
  diffRemovedMediaUrls,
  queuePublicMediaCleanup,
} from "@/lib/services/media-cleanup";
import {
  confirmMediaUploads,
  MediaUploadConfirmationError,
} from "@/lib/media/confirm-media-uploads";
import {
  applyOwnerFilter,
  getOwnerColumn,
  normalizeOwnerRecord,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { userOwnsBusiness } from "@/lib/account/owned-business";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createNotification, shouldSendOwnerLifecycleNotifications } from "@/lib/notifications";
import {
  buildViewerKey,
  createAnonymousViewerId,
  ENGAGEMENT_VIEWER_COOKIE,
} from "@/lib/engagement";
import { createOwnedContentDeleteRoute } from "@/app/api/_lib/create-owned-content-delete-route";
import { createViewerCookieJsonResponse } from "@/app/api/_lib/engagement-viewer-cookie-response";
import { requireAuthenticatedLocalMutation } from "@/app/api/_lib/authenticated-local-mutation";
import {
  enforcePostingMediaLimits,
  getPostingEntitlementsOrResponse,
} from "@/app/api/_lib/posting-entitlements";
import { idRouteParamsSchema } from "@/app/api/_lib/route-params";
import {
  contentEditSubmittedResponse,
  createContentEditRequest,
  editLimitReachedResponse,
  hasPendingContentEdit,
  isEditLimitReached,
} from "@/lib/content-edit-requests";

const log = createLogger("PromotionDetail");
type PromotionOwnerRow = {
  id: string;
  status: string;
  owner_id?: string | null;
  seller_id?: string | null;
  title?: string | null;
  description?: string | null;
  promotion_type?: string | null;
  category?: string | null;
  category_key?: string | null;
  price_cents?: number | null;
  location_province?: string | null;
  location_city?: string | null;
  location_town?: string | null;
  location_address?: string | null;
  contact_methods?: string[] | null;
  start_date?: string | null;
  end_date?: string | null;
  photos?: string[] | null;
  videos?: string[] | null;
  video_thumbnail?: string | null;
  logo_url?: string | null;
  media_width?: number | null;
  media_height?: number | null;
  focal_x?: number | null;
  focal_y?: number | null;
  view_count?: number | null;
  event_details?: Record<string, unknown> | null;
  approved_edit_count?: number | null;
};

/**
 * GET /api/promotions/[id]
 *
 * Get a single promotion by ID. Public for live promotions.
 * Increments view_count.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = parseAndValidateRouteParams(await params, idRouteParamsSchema, {
      validationErrorMessage: "Invalid Tourism & Events post ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id } = parsedParams.data;

    const supabase = await createClient();
    const { data: promotion, error } = await supabase
      .from("promotions")
      .select(
        "id, owner_id, business_id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, media_width, media_height, focal_x, focal_y, logo_url, price_cents, price_negotiable, location_province, location_city, location_town, location_address, contact_methods, start_date, end_date, event_details, boost_until, featured_until, status, view_count, published_at, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      log.error("Failed to fetch promotion", {
        id,
        error: error.message,
      });
      return NextResponse.json({ error: "Failed to fetch Tourism & Events post" }, { status: 500 });
    }

    if (!promotion) {
      return NextResponse.json({ error: "Tourism & Events post not found" }, { status: 404 });
    }

    const normalizedPromotion = normalizeOwnerRecord(promotion as PromotionOwnerRow);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isOwnerViewer = Boolean(user && user.id === readOwnerId(normalizedPromotion));

    // Only allow public access to live promotions
    if (normalizedPromotion.status !== "live") {
      if (!isOwnerViewer) {
        return NextResponse.json({ error: "Tourism & Events post not found" }, { status: 404 });
      }
    }

    const existingViewerId = request.cookies?.get?.(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
    const nextViewerId = existingViewerId ?? createAnonymousViewerId();
    const viewerKey = buildViewerKey(nextViewerId, user?.id ?? null);

    if (normalizedPromotion.status === "live") {
      // Increment unique viewer count (best-effort, non-blocking).
      try {
        const admin = createAdminClient();
        const rpc = admin.rpc?.bind(admin);
        if (rpc) {
          Promise.resolve(
            rpc("record_content_view", {
              p_target_id: id,
              p_target_type: "promotion",
              p_viewer_key: viewerKey,
              p_viewer_user_id: user?.id ?? null,
              p_viewer_ip_hash: null,
            })
          )
            .then(({ error }) => {
              if (error) log.warn("View count increment failed", { id, error: error.message });
            })
            .catch((err: unknown) => log.warn("View count RPC error", { id, error: String(err) }));
        }
      } catch (viewError) {
        log.warn("View count tracking setup failed", {
          id,
          error: viewError instanceof Error ? viewError.message : "Unknown error",
        });
      }
    }

    // Strip owner identifiers from public response (POPIA data minimization)
    const { owner_id: _oid, seller_id: _sid, ...publicPromotion } = normalizedPromotion;

    return createViewerCookieJsonResponse(
      {
        promotion: publicPromotion,
      },
      existingViewerId,
      nextViewerId
    );
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to fetch Tourism & Events post" }, { status: 500 });
  }
}

/**
 * PUT /api/promotions/[id]
 *
 * Update a promotion. Requires authentication and ownership.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const parsedParams = parseAndValidateRouteParams(await params, idRouteParamsSchema, {
      validationErrorMessage: "Invalid Tourism & Events post ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id } = parsedParams.data;

    const supabase = await createClient();
    const mutationAccess = await requireAuthenticatedLocalMutation(supabase, "promotion:update");
    if (mutationAccess.response) {
      return mutationAccess.response;
    }
    const { user } = mutationAccess;

    const ownerColumn = await getOwnerColumn(supabase, "promotions");

    // Check ownership
    const { data: rawExisting } = await applyOwnerFilter(
      supabase
        .from("promotions")
        .select(
          withOwnerColumn(
            "id, owner_id, status, title, description, promotion_type, category, category_key, business_id, photos, videos, video_thumbnail, logo_url, media_width, media_height, focal_x, focal_y, price_cents, price_negotiable, location_province, location_city, location_town, location_address, contact_methods, start_date, end_date, event_details, approved_edit_count",
            ownerColumn
          )
        )
        .eq("id", id),
      ownerColumn,
      user.id
    ).maybeSingle();
    const existing = rawExisting as PromotionOwnerRow | null;

    if (!existing) {
      return NextResponse.json({ error: "Tourism & Events post not found" }, { status: 404 });
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

    if (data.business_id) {
      const ownsBusiness = await userOwnsBusiness(supabase, user.id, data.business_id);
      if (!ownsBusiness) {
        return NextResponse.json({ error: "Linked business not found" }, { status: 404 });
      }
    }

    const entitlementsResult = await getPostingEntitlementsOrResponse(
      supabase,
      user.id,
      "PROMOTIONS_EVENTS",
      log
    );
    if (entitlementsResult.response) {
      return entitlementsResult.response;
    }
    const ent = entitlementsResult.entitlements;

    const mediaLimitBlock = enforcePostingMediaLimits({
      entitlements: ent,
      photoCount: data.images.length,
      videoCount: data.videos.length,
    });
    if (mediaLimitBlock) return mediaLimitBlock;

    const currentMediaUrls = collectMediaUrls(
      existing.photos,
      existing.videos,
      existing.video_thumbnail,
      existing.logo_url
    );
    const nextMediaUrls = collectMediaUrls(
      data.images,
      data.videos,
      data.video_thumbnail || null,
      data.logo_url || null
    );
    const addedMediaUrls = diffRemovedMediaUrls(nextMediaUrls, currentMediaUrls);
    const removedMediaUrls = diffRemovedMediaUrls(currentMediaUrls, nextMediaUrls);

    const priceCents =
      data.price_zar != null ? Math.round(+(data.price_zar * 100).toPrecision(12)) : null;

    // Only re-trigger moderation when substantive content fields change (#33)
    const contentChanged =
      existing.title !== data.title ||
      existing.description !== data.description ||
      existing.promotion_type !== data.promotion_type ||
      existing.category !== (data.category || null) ||
      existing.category_key !== categoryKey ||
      existing.price_cents !== priceCents ||
      existing.location_province !== data.province ||
      existing.location_city !== data.city ||
      (existing.location_town ?? null) !== (data.location_town || null) ||
      (existing.location_address ?? null) !== (data.location_address || null) ||
      (existing.start_date ?? null) !== (data.start_date || null) ||
      (existing.end_date ?? null) !== (data.end_date || null) ||
      (existing.logo_url ?? null) !== (data.logo_url || null) ||
      JSON.stringify(existing.contact_methods ?? null) !==
        JSON.stringify(data.contact_methods ?? null) ||
      JSON.stringify(existing.photos) !== JSON.stringify(data.images) ||
      JSON.stringify(existing.videos) !== JSON.stringify(data.videos) ||
      (existing.video_thumbnail ?? null) !== (data.video_thumbnail || null) ||
      JSON.stringify(existing.event_details ?? null) !== JSON.stringify(data.event_details ?? null);

    const proposedPayload = {
      title: data.title,
      description: data.description,
      promotion_type: data.promotion_type,
      category: data.category || null,
      category_key: categoryKey,
      business_id: data.business_id || null,
      photos: data.images,
      videos: data.videos,
      video_thumbnail: data.video_thumbnail || null,
      media_width:
        data.media_width !== undefined ? data.media_width : (existing.media_width ?? null),
      media_height:
        data.media_height !== undefined ? data.media_height : (existing.media_height ?? null),
      focal_x: data.focal_x ?? existing.focal_x ?? 0.5,
      focal_y: data.focal_y ?? existing.focal_y ?? 0.5,
      price_cents: priceCents,
      price_negotiable: data.negotiable,
      location_province: data.province,
      location_city: data.city,
      location_town: data.location_town || null,
      location_address: data.location_address || null,
      contact_methods: data.contact_methods,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      logo_url: data.logo_url || null,
      event_details: data.event_details ?? existing.event_details ?? null,
    };

    const admin = createAdminClient();

    if (existing.status === "live" && contentChanged) {
      if (isEditLimitReached(existing.approved_edit_count)) {
        return editLimitReachedResponse();
      }

      try {
        if (await hasPendingContentEdit(admin, "promotion", id)) {
          return NextResponse.json(
            {
              error: "This tourism and events post already has an edit pending admin review.",
              code: "pending_edit_exists",
              pendingEditExists: true,
            },
            { status: 409 }
          );
        }
      } catch (pendingEditError) {
        log.error("Failed to check pending promotion edit request", {
          promotionId: id,
          userId: user.id,
          error: pendingEditError instanceof Error ? pendingEditError.message : "Unknown error",
        });
        return NextResponse.json({ error: "Unable to verify edit review status" }, { status: 503 });
      }

      try {
        await confirmMediaUploads({
          supabase: admin,
          userId: user.id,
          urls: addedMediaUrls,
          contentType: "promotion",
          contentId: id,
        });

        const editRequest = await createContentEditRequest({
          supabase: admin,
          targetType: "promotion",
          targetId: id,
          ownerId: user.id,
          area: "PROMOTIONS_EVENTS",
          proposedData: { ...proposedPayload, status: "live" },
          currentSnapshot: existing as unknown as Record<string, unknown>,
        });

        if (editRequest.response) {
          return editRequest.response;
        }
      } catch (editRequestError) {
        if (editRequestError instanceof MediaUploadConfirmationError) {
          return NextResponse.json({ error: "Invalid media upload" }, { status: 422 });
        }

        log.error("Failed to create promotion edit request", {
          promotionId: id,
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
          targetType: "promotion",
          targetId: id,
          metadata: { title: data.title, pendingReview: true },
        });
      } catch {
        // non-fatal
      }

      if (shouldSendOwnerLifecycleNotifications()) {
        void createNotification({
          userId: user.id,
          type: "warning",
          title: "Tourism & Event edit submitted for review",
          message: `\"${data.title}\" will stay live with its current approved details until this edit is approved.`,
          href: "/dashboard/tourism-events",
        });
      }

      return contentEditSubmittedResponse(id, existing.approved_edit_count);
    }

    try {
      await confirmMediaUploads({
        supabase: admin,
        userId: user.id,
        urls: addedMediaUrls,
        contentType: "promotion",
        contentId: id,
      });
    } catch (mediaError) {
      if (mediaError instanceof MediaUploadConfirmationError) {
        return NextResponse.json({ error: "Invalid media upload" }, { status: 422 });
      }
      throw mediaError;
    }

    const shouldMoveBackToModeration =
      contentChanged && ["live", "approved"].includes(existing.status);
    const updateQuery = applyOwnerFilter(
      supabase
        .from("promotions")
        .update({
          ...proposedPayload,
          ...(shouldMoveBackToModeration ? { status: "pending_moderation" } : {}),
        })
        .eq("id", id),
      ownerColumn,
      user.id
    );

    const { error: updateError } = await updateQuery;

    if (updateError) {
      log.error("Failed to update promotion", { error: updateError.message });
      return NextResponse.json(
        { error: "Failed to update Tourism & Events post" },
        { status: 500 }
      );
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

    if (shouldSendOwnerLifecycleNotifications()) {
      void createNotification({
        userId: user.id,
        type: shouldMoveBackToModeration ? "warning" : "info",
        title: shouldMoveBackToModeration
          ? "Tourism & Event post moved to review"
          : "Tourism & Event post updated",
        message: shouldMoveBackToModeration
          ? `\"${data.title}\" was updated and is now pending moderation.`
          : `\"${data.title}\" was updated successfully.`,
        href: "/dashboard/tourism-events",
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to update Tourism & Events post" }, { status: 500 });
  }
}

/**
 * DELETE /api/promotions/[id]
 *
 * Delete a promotion. Only draft or rejected promotions can be deleted.
 */
export const DELETE = createOwnedContentDeleteRoute<{ id: string }, PromotionOwnerRow>({
  log,
  paramsSchema: idRouteParamsSchema,
  validationErrorMessage: "Invalid Tourism & Events post ID",
  table: "promotions",
  ownerSelect: "id, owner_id, status, photos, videos, video_thumbnail, logo_url",
  rateLimitKey: "promotion:delete",
  notFoundMessage: "Tourism & Events post not found",
  invalidStatusMessage: "Only draft or rejected Tourism & Events posts can be deleted",
  deleteErrorMessage: "Failed to delete Tourism & Events post",
  deleteErrorLogMessage: "Failed to delete promotion",
  cleanupReason: "promotion_deleted",
  cleanupErrorLogMessage: "Failed to queue deleted promotion media for cleanup",
  cleanupErrorIdKey: "promotionId",
  auditTargetType: "promotion",
  getEntityId: ({ id }) => id,
  canDelete: (existing) => ["draft", "rejected"].includes(existing.status),
  collectDeletedMediaUrls: (existing) =>
    collectMediaUrls(existing.photos, existing.videos, existing.video_thumbnail, existing.logo_url),
});
