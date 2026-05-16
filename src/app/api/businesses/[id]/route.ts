import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest, parseAndValidateRouteParams } from "@/lib/utils/api";
import { businessSchema } from "@/lib/validations/business-unified";
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
import {
  confirmMediaUploads,
  MediaUploadConfirmationError,
} from "@/lib/media/confirm-media-uploads";
import {
  BUSINESS_SLUG_CONFLICT_RESPONSE,
  isBusinessSlugConflictError,
} from "@/lib/businesses/slug-conflict";
import type { BusinessDetails } from "@/types/business-details";
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
import { buildBusinessMutationPayload } from "@/app/api/businesses/_lib/build-business-mutation-payload";
import { idRouteParamsSchema } from "@/app/api/_lib/route-params";
import type { MarketplaceArea } from "@/types/enums";
import {
  contentEditSubmittedResponse,
  createContentEditRequest,
  editLimitReachedResponse,
  hasPendingContentEdit,
  isEditLimitReached,
} from "@/lib/content-edit-requests";
import { applyVisibleExpiryFilter, isVisibleByExpiry } from "@/lib/posting/visibility";

const log = createLogger("BusinessDetail");
const BUSINESS_DETAIL_SELECT = `
  id, owner_id, business_type, business_name, slug, description, category, logo_url,
  cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city,
  location_town, location_address,
  store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, layout_template, boost_until, featured_until, published_at, status, area, created_at,
  expires_at, updated_at, media_width, media_height, focal_x, focal_y
`;
type BusinessOwnerRow = {
  id: string;
  status: string;
  area?: string | null;
  owner_id?: string | null;
  logo_url?: string | null;
  cover_photo?: string | null;
  cover_video?: string | null;
  video_thumbnail?: string | null;
  gallery_photos?: string[] | null;
  media_width?: number | null;
  media_height?: number | null;
  focal_x?: number | null;
  focal_y?: number | null;
  business_details?: BusinessDetails | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  approved_edit_count?: number | null;
  expires_at?: string | null;
};

function getMallPhotoUrls(details: BusinessDetails | null | undefined): string[] {
  return details?.type === "mall_store" ? (details.mall_photos ?? []) : [];
}

/**
 * GET /api/businesses/[id]
 *
 * Get a single business by ID. Public for live businesses.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = parseAndValidateRouteParams(await params, idRouteParamsSchema, {
      validationErrorMessage: "Invalid business ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id } = parsedParams.data;

    const supabase = await createClient();
    const ownerColumn = await getOwnerColumn(supabase, "businesses");
    const { data: business, error } = await supabase
      .from("businesses")
      .select(withOwnerColumn(BUSINESS_DETAIL_SELECT, ownerColumn))
      .eq("id", id)
      .maybeSingle();

    if (error || !business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const normalizedBusiness = normalizeOwnerRecord(business as unknown as BusinessOwnerRow);

    // Fetch user once — reused for both ownership and contact redaction checks
    let currentUser: { id: string } | null = null;

    // Only allow public access to live businesses
    const isExpiredLivePost =
      normalizedBusiness.status === "live" && !isVisibleByExpiry(normalizedBusiness.expires_at);

    if (normalizedBusiness.status !== "live" || isExpiredLivePost) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      currentUser = user;

      if (!user || user.id !== readOwnerId(normalizedBusiness)) {
        return NextResponse.json({ error: "Business not found" }, { status: 404 });
      }
    }

    // Fetch linked promotions
    const { data: promotions, error: promoError } = await applyVisibleExpiryFilter(
      supabase
        .from("promotions")
        .select(
          "id, title, promotion_type, photos, price_cents, start_date, end_date, boost_until, created_at"
        )
        .eq("business_id", id)
        .eq("status", "live")
    )
      .order("boost_until", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(12);

    if (promoError) {
      log.warn("Failed to fetch linked promotions", { businessId: id, error: promoError.message });
    }

    if (!currentUser) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      currentUser = user;
    }

    const existingViewerId = request.cookies?.get?.(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
    const nextViewerId = existingViewerId ?? createAnonymousViewerId();
    const viewerKey = buildViewerKey(nextViewerId, currentUser?.id ?? null);

    if (normalizedBusiness.status === "live") {
      // Track view (best-effort — never block the response)
      try {
        const admin = createAdminClient();
        const rpc = admin.rpc?.bind(admin);
        if (rpc) {
          void rpc("record_content_view", {
            p_target_id: id,
            p_target_type: "business",
            p_viewer_key: viewerKey,
            p_viewer_user_id: currentUser?.id ?? null,
            p_viewer_ip_hash: null,
          }).then(({ error: viewErr }) => {
            if (viewErr) {
              log.warn("View tracking failed", { error: viewErr.message, businessId: id });
            }
          });
        }
      } catch (viewError) {
        log.warn("View tracking setup failed", {
          businessId: id,
          error: viewError instanceof Error ? viewError.message : "Unknown error",
        });
      }
    }

    // Strip owner identifiers from public response (POPIA data minimization)
    const { owner_id: _oid, ...publicBusiness } = normalizedBusiness;

    // M3: Redact contact fields for unauthenticated requests to prevent
    // email/phone harvesting. Authenticated users can see full details.
    // Reuse the user fetched above for non-live checks; fetch lazily otherwise.
    if (!currentUser) {
      const { phone: _p, whatsapp: _w, email: _e, ...redactedBusiness } = publicBusiness;
      return createViewerCookieJsonResponse(
        {
          business: redactedBusiness,
          promotions: promotions ?? [],
        },
        existingViewerId,
        nextViewerId
      );
    }

    return createViewerCookieJsonResponse(
      { business: publicBusiness, promotions: promotions ?? [] },
      existingViewerId,
      nextViewerId
    );
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
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
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const parsedParams = parseAndValidateRouteParams(await params, idRouteParamsSchema, {
      validationErrorMessage: "Invalid business ID",
      includeValidationDetails: false,
    });
    if (!parsedParams.success) {
      return parsedParams.response;
    }
    const { id } = parsedParams.data;

    const supabase = await createClient();
    const mutationAccess = await requireAuthenticatedLocalMutation(supabase, "business:update");
    if (mutationAccess.response) {
      return mutationAccess.response;
    }
    const { user } = mutationAccess;

    const ownerColumn = await getOwnerColumn(supabase, "businesses");

    // Check ownership
    const { data: rawExisting } = await applyOwnerFilter(
      supabase
        .from("businesses")
        .select(
          withOwnerColumn(
            "id, owner_id, status, area, business_name, slug, business_type, description, category, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province, location_city, location_town, location_address, store_number, map_directions, phone, whatsapp, email, website, social_links, operating_hours, services_offered, service_areas, business_details, payment_methods_accepted, delivery_options, layout_template, media_width, media_height, focal_x, focal_y, approved_edit_count",
            ownerColumn
          )
        )
        .eq("id", id),
      ownerColumn,
      user.id
    ).maybeSingle();
    const existing = rawExisting as BusinessOwnerRow | null;

    if (!existing) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    const parsedBody = await parseAndValidateJsonRequest(request, businessSchema, {
      invalidJsonMessage: "Invalid JSON body",
      validationErrorMessage: "Validation failed",
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const data = parsedBody.data;
    const effectiveArea: MarketplaceArea =
      existing.area === "PROMOTIONS_EVENTS" ? "PROMOTIONS_EVENTS" : "MZANSI_BUSINESS";
    const entitlementsResult = await getPostingEntitlementsOrResponse(
      supabase,
      user.id,
      effectiveArea,
      log
    );
    if (entitlementsResult.response) {
      return entitlementsResult.response;
    }
    const ent = entitlementsResult.entitlements;

    const mediaLimitBlock = enforcePostingMediaLimits({
      entitlements: ent,
      photoCount: data.gallery_photos?.length ?? 0,
      videoCount: data.cover_video ? 1 : 0,
      photoLabel: "gallery photos",
      videoUnavailableMessage: "Video is not available on your current plan.",
    });
    if (mediaLimitBlock) return mediaLimitBlock;

    const admin = createAdminClient();
    const { data: slugConflict, error: slugError } = await admin
      .from("businesses")
      .select("id")
      .eq("slug", data.slug)
      .neq("id", id)
      .maybeSingle();

    if (slugError) {
      log.error("Failed to check slug uniqueness", { slug: data.slug, error: slugError.message });
      return NextResponse.json({ error: "Unable to validate business URL" }, { status: 500 });
    }

    if (slugConflict) {
      return NextResponse.json(BUSINESS_SLUG_CONFLICT_RESPONSE, { status: 409 });
    }

    const proposedPayload = buildBusinessMutationPayload(data, {
      mediaFallbacks: existing,
    });

    if (existing.status === "live") {
      if (isEditLimitReached(existing.approved_edit_count)) {
        return editLimitReachedResponse();
      }

      try {
        if (await hasPendingContentEdit(admin, "business", id)) {
          return NextResponse.json(
            {
              error: "This business profile already has an edit pending admin review.",
              code: "pending_edit_exists",
              pendingEditExists: true,
            },
            { status: 409 }
          );
        }
      } catch (pendingEditError) {
        log.error("Failed to check pending business edit request", {
          businessId: id,
          userId: user.id,
          error: pendingEditError instanceof Error ? pendingEditError.message : "Unknown error",
        });
        return NextResponse.json({ error: "Unable to verify edit review status" }, { status: 503 });
      }
    }

    const nextMediaUrls = collectMediaUrls(
      data.logo_url || null,
      data.cover_photo || null,
      data.cover_video || null,
      data.video_thumbnail || null,
      data.gallery_photos || [],
      getMallPhotoUrls(data.business_details)
    );
    const currentMediaUrls = collectMediaUrls(
      existing.logo_url,
      existing.cover_photo,
      existing.cover_video,
      existing.video_thumbnail,
      existing.gallery_photos,
      getMallPhotoUrls(existing.business_details as BusinessDetails | null | undefined)
    );
    const addedMediaUrls = diffRemovedMediaUrls(nextMediaUrls, currentMediaUrls);
    const removedMediaUrls = diffRemovedMediaUrls(currentMediaUrls, nextMediaUrls);

    if (existing.status === "live") {
      try {
        await confirmMediaUploads({
          supabase: admin,
          userId: user.id,
          urls: addedMediaUrls,
          contentType: "business",
          contentId: id,
        });

        const editRequest = await createContentEditRequest({
          supabase: admin,
          targetType: "business",
          targetId: id,
          ownerId: user.id,
          area: effectiveArea,
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

        log.error("Failed to create business edit request", {
          businessId: id,
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
          targetType: "business",
          targetId: id,
          area: effectiveArea,
          metadata: { business_name: data.business_name, pendingReview: true },
        });
      } catch {
        // non-fatal
      }

      if (shouldSendOwnerLifecycleNotifications()) {
        void createNotification({
          userId: user.id,
          type: "warning",
          title: "Business profile edit submitted for review",
          message: `\"${data.business_name}\" will stay live with its current approved details until this edit is approved.`,
          href: "/dashboard/businesses",
        });
      }

      return contentEditSubmittedResponse(id, existing.approved_edit_count);
    }

    try {
      await confirmMediaUploads({
        supabase: admin,
        userId: user.id,
        urls: addedMediaUrls,
        contentType: "business",
        contentId: id,
      });
    } catch (mediaError) {
      if (mediaError instanceof MediaUploadConfirmationError) {
        return NextResponse.json({ error: "Invalid media upload" }, { status: 422 });
      }
      throw mediaError;
    }

    const updateQuery = applyOwnerFilter(
      supabase
        .from("businesses")
        .update({
          ...proposedPayload,
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
      if (isBusinessSlugConflictError(updateError)) {
        return NextResponse.json(BUSINESS_SLUG_CONFLICT_RESPONSE, { status: 409 });
      }

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
        area: effectiveArea,
        metadata: { business_name: data.business_name },
      });
    } catch {
      // non-fatal
    }

    if (shouldSendOwnerLifecycleNotifications()) {
      const movedBackToReview = existing.status === "live";
      void createNotification({
        userId: user.id,
        type: movedBackToReview ? "warning" : "info",
        title: movedBackToReview ? "Business profile moved to review" : "Business profile updated",
        message: movedBackToReview
          ? `\"${data.business_name}\" was updated and is now pending moderation.`
          : `\"${data.business_name}\" was updated successfully.`,
        href: "/dashboard/businesses",
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Failed to update business" }, { status: 500 });
  }
}

/**
 * DELETE /api/businesses/[id]
 *
 * Delete a business. Only draft or rejected businesses can be deleted.
 */
export const DELETE = createOwnedContentDeleteRoute<{ id: string }, BusinessOwnerRow>({
  log,
  paramsSchema: idRouteParamsSchema,
  validationErrorMessage: "Invalid business ID",
  table: "businesses",
  ownerSelect:
    "id, owner_id, status, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, business_details",
  rateLimitKey: "business:delete",
  notFoundMessage: "Business not found",
  invalidStatusMessage: "Only draft or rejected businesses can be deleted",
  deleteErrorMessage: "Failed to delete business",
  deleteErrorLogMessage: "Failed to delete business",
  cleanupReason: "business_deleted",
  cleanupErrorLogMessage: "Failed to queue deleted business media for cleanup",
  cleanupErrorIdKey: "businessId",
  auditTargetType: "business",
  auditArea: "MZANSI_BUSINESS",
  getEntityId: ({ id }) => id,
  canDelete: (existing) => ["draft", "rejected"].includes(existing.status),
  collectDeletedMediaUrls: (existing) =>
    collectMediaUrls(
      existing.logo_url,
      existing.cover_photo,
      existing.cover_video,
      existing.video_thumbnail,
      existing.gallery_photos,
      getMallPhotoUrls(existing.business_details as BusinessDetails | null | undefined)
    ),
});
