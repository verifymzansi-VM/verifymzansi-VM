import type { NextRequest } from "next/server";
import {
  handleRestoredPostMutation,
  handleRestoredPostRead,
} from "@/lib/foundation/restored-post-route";
import { createLogger } from "@/lib/utils/logger";
import { collectMediaUrls } from "@/lib/services/media-cleanup";
import { createOwnedContentDeleteRoute } from "@/app/api/_lib/create-owned-content-delete-route";
import { idRouteParamsSchema } from "@/app/api/_lib/route-params";

const log = createLogger("PromotionDetail");
/** The columns DELETE reads (its ownerSelect). */
type PromotionOwnerRow = {
  id: string;
  status: string;
  owner_id?: string | null;
  photos?: string[] | null;
  videos?: string[] | null;
  video_thumbnail?: string | null;
  logo_url?: string | null;
};

/**
 * GET /api/promotions/[id]
 *
 * Get a single promotion by ID. Public for live promotions.
 * Increments view_count.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostRead(request, "promotions", (await params).id);
}

/**
 * PUT /api/promotions/[id]
 *
 * Update a promotion. Requires authentication and ownership.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRestoredPostMutation(request, "promotions", (await params).id);
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
