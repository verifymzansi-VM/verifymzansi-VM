import type { NextRequest } from "next/server";
import {
  handleRestoredPostMutation,
  handleRestoredPostRead,
} from "@/lib/foundation/restored-post-route";
import { getBusinessVenuePhotoUrls } from "@/lib/business/venue-photos";
import { createLogger } from "@/lib/utils/logger";
import { collectMediaUrls } from "@/lib/services/media-cleanup";
import type { BusinessDetails } from "@/types/business-details";
import { createOwnedContentDeleteRoute } from "@/app/api/_lib/create-owned-content-delete-route";
import { idRouteParamsSchema } from "@/app/api/_lib/route-params";

const log = createLogger("BusinessDetail");
/** The columns DELETE reads (its ownerSelect). */
type BusinessOwnerRow = {
  id: string;
  status: string;
  owner_id?: string | null;
  logo_url?: string | null;
  cover_photo?: string | null;
  cover_video?: string | null;
  video_thumbnail?: string | null;
  gallery_photos?: string[] | null;
  business_details?: BusinessDetails | null;
  category_details?: Record<string, unknown> | null;
};

/**
 * GET /api/businesses/[id]
 *
 * Get a single business by ID. Public for live businesses.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostRead(request, "businesses", (await params).id);
}

/**
 * PATCH /api/businesses/[id]
 *
 * Update a business. Requires authentication and ownership.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostMutation(request, "businesses", (await params).id);
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
    "id, owner_id, status, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, business_details, category_details",
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
      getBusinessVenuePhotoUrls(existing.business_details, existing.category_details)
    ),
});
