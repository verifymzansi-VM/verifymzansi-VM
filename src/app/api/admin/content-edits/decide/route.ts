import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createNotification } from "@/lib/notifications";
import { adminContentEditDecideSchema } from "@/lib/validations/admin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { createLogger } from "@/lib/utils/logger";
import {
  MAX_APPROVED_CONTENT_EDITS,
  type ContentEditRequest,
  type ContentEditTargetType,
} from "@/lib/content-edit-requests";
import {
  collectMediaUrls,
  diffRemovedMediaUrls,
  queuePublicMediaCleanup,
} from "@/lib/services/media-cleanup";

const log = createLogger("AdminContentEditDecide");

const targetConfig: Record<
  ContentEditTargetType,
  {
    table: "listings" | "businesses" | "promotions";
    label: string;
    titleField: string;
    dashboardHref: string;
  }
> = {
  listing: {
    table: "listings",
    label: "Listing",
    titleField: "title",
    dashboardHref: "/dashboard/listings",
  },
  business: {
    table: "businesses",
    label: "Business profile",
    titleField: "business_name",
    dashboardHref: "/dashboard/businesses",
  },
  promotion: {
    table: "promotions",
    label: "Tourism & Event post",
    titleField: "title",
    dashboardHref: "/dashboard/tourism-events",
  },
};

function getContentTitle(request: ContentEditRequest) {
  const config = targetConfig[request.target_type];
  const proposedTitle = request.proposed_data[config.titleField];
  const currentTitle = request.current_snapshot[config.titleField];
  const title =
    (typeof proposedTitle === "string" && proposedTitle.trim()) ||
    (typeof currentTitle === "string" && currentTitle.trim()) ||
    "your post";
  return title.slice(0, 80);
}

function collectRequestMedia(data: Record<string, unknown>) {
  return collectMediaUrls(
    data.photos as string[] | null | undefined,
    data.videos as string[] | null | undefined,
    data.video_thumbnail as string | null | undefined,
    data.logo_url as string | null | undefined,
    data.cover_photo as string | null | undefined,
    data.cover_video as string | null | undefined,
    data.gallery_photos as string[] | null | undefined
  );
}

export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      rateLimitAction: "admin:content-edit:decide",
    });
    if (!guard.success) return guard.response;

    const bodyResult = await parseAndValidateJsonRequest(request, adminContentEditDecideSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { requestId, decision, reason } = bodyResult.data;
    const admin = createAdminClient();

    const { data: requestRow, error: requestError } = await admin
      .from("content_edit_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pending")
      .maybeSingle();

    if (requestError) {
      log.error("Failed to load content edit request", {
        requestId,
        error: requestError.message,
      });
      return NextResponse.json({ error: "Failed to load edit request" }, { status: 500 });
    }

    if (!requestRow) {
      return NextResponse.json({ error: "Edit request not found" }, { status: 404 });
    }

    const editRequest = requestRow as ContentEditRequest;
    const config = targetConfig[editRequest.target_type];
    const contentTitle = getContentTitle(editRequest);

    if (decision === "reject") {
      const { data: rejectedRows, error: rejectError } = await admin
        .from("content_edit_requests")
        .update({
          status: "rejected",
          reason,
          reviewed_by: guard.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .eq("status", "pending")
        .select("id");

      if (rejectError) {
        log.error("Failed to reject content edit request", {
          requestId,
          error: rejectError.message,
        });
        return NextResponse.json({ error: "Failed to reject edit request" }, { status: 500 });
      }

      if (!rejectedRows || rejectedRows.length === 0) {
        return NextResponse.json({ error: "Edit request was already reviewed" }, { status: 409 });
      }

      const pendingOnlyMedia = diffRemovedMediaUrls(
        collectRequestMedia(editRequest.proposed_data),
        collectRequestMedia(editRequest.current_snapshot)
      );
      if (pendingOnlyMedia.length > 0) {
        try {
          await queuePublicMediaCleanup(admin, pendingOnlyMedia, "content_edit_rejected");
        } catch (cleanupError) {
          log.warn("Failed to queue rejected edit media cleanup", {
            requestId,
            error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
          });
        }
      }

      await logAuditEvent({
        actorId: guard.user.id,
        actorRole: guard.actorRole,
        action: "moderation_action",
        targetType: `${editRequest.target_type}_edit`,
        targetId: editRequest.target_id,
        area: editRequest.area,
        metadata: { decision, requestId, reason },
      });

      await createNotification({
        userId: editRequest.owner_id,
        type: "error",
        title: `${config.label} edit rejected`,
        message: reason
          ? `Your edit to \"${contentTitle}\" was rejected: ${reason.slice(0, 80)}`
          : `Your edit to \"${contentTitle}\" was rejected.`,
        href: config.dashboardHref,
      });

      return NextResponse.json({ success: true, decision });
    }

    const { data: targetRow, error: targetFetchError } = await admin
      .from(config.table)
      .select("*")
      .eq("id", editRequest.target_id)
      .maybeSingle();

    if (targetFetchError) {
      log.error("Failed to load content target for edit approval", {
        requestId,
        targetId: editRequest.target_id,
        error: targetFetchError.message,
      });
      return NextResponse.json({ error: "Failed to load content item" }, { status: 500 });
    }

    if (!targetRow || targetRow.status !== "live") {
      return NextResponse.json({ error: "Live content item not found" }, { status: 409 });
    }

    const approvedEditCount = Number(targetRow.approved_edit_count ?? 0);
    if (approvedEditCount >= MAX_APPROVED_CONTENT_EDITS) {
      return NextResponse.json(
        {
          error: "This post has reached the maximum of two approved edits.",
          code: "edit_limit_reached",
        },
        { status: 409 }
      );
    }

    const updatePayload = {
      ...editRequest.proposed_data,
      status: "live",
      approved_edit_count: approvedEditCount + 1,
    };

    const { data: updatedTargets, error: updateError } = await admin
      .from(config.table)
      .update(updatePayload)
      .eq("id", editRequest.target_id)
      .eq("status", "live")
      .select("id");

    if (updateError) {
      log.error("Failed to apply content edit", {
        requestId,
        targetId: editRequest.target_id,
        error: updateError.message,
      });
      return NextResponse.json({ error: "Failed to apply edit" }, { status: 500 });
    }

    if (!updatedTargets || updatedTargets.length === 0) {
      return NextResponse.json({ error: "Edit could not be applied" }, { status: 409 });
    }

    const { error: markApprovedError } = await admin
      .from("content_edit_requests")
      .update({
        status: "approved",
        reason: null,
        reviewed_by: guard.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending");

    if (markApprovedError) {
      log.error("Applied content edit but failed to mark request approved", {
        requestId,
        error: markApprovedError.message,
      });
      return NextResponse.json(
        { error: "Edit was applied but review state was not updated" },
        { status: 500 }
      );
    }

    const removedLiveMedia = diffRemovedMediaUrls(
      collectRequestMedia(editRequest.current_snapshot),
      collectRequestMedia(editRequest.proposed_data)
    );
    if (removedLiveMedia.length > 0) {
      try {
        await queuePublicMediaCleanup(admin, removedLiveMedia, "content_edit_approved");
      } catch (cleanupError) {
        log.warn("Failed to queue approved edit media cleanup", {
          requestId,
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
        });
      }
    }

    await logAuditEvent({
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      action: "moderation_action",
      targetType: `${editRequest.target_type}_edit`,
      targetId: editRequest.target_id,
      area: editRequest.area,
      metadata: { decision, requestId, approvedEditCount: approvedEditCount + 1 },
    });

    await createNotification({
      userId: editRequest.owner_id,
      type: "success",
      title: `${config.label} edit approved`,
      message: `Your edit to \"${contentTitle}\" is now live.`,
      href: config.dashboardHref,
    });

    return NextResponse.json({ success: true, decision });
  } catch (err) {
    log.error("Content edit decide failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
