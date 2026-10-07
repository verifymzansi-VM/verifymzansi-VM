import { NextResponse } from "next/server";
import { withAllPrivateFields } from "@/lib/content/private-fields";
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
import { checkQueueClaim, releaseDecidedClaim } from "@/lib/services/queue-claims";

const log = createLogger("AdminContentEditDecide");

/** Columns only system workflows (billing, moderation, lifecycle) may write. */
const SYSTEM_CONTROLLED_COLUMNS = new Set([
  "id",
  "owner_id",
  "seller_id",
  "area",
  "status",
  "status_reason",
  "entitlement_id",
  "created_at",
  "updated_at",
  "published_at",
  "expires_at",
  "boost_until",
  "featured_until",
  "urgent_until",
  "featured",
  "urgent",
  "view_count",
  "click_count",
  "approved_edit_count",
  "edited_since_review",
  "search_vector",
  "social_distribution_authorized",
  "social_distribution_authorized_at",
  "social_distribution_revoked_at",
  // Business verification stickers are set only by verification decisions.
  "cipc_verified_at",
  "cipc_expires_at",
  "cipc_registration_number",
  "cipc_registered_name",
  "cipc_registered_office",
  "show_full_registered_office",
  "seen_verified_at",
  "seen_expires_at",
  "seen_method",
  "seen_city",
  "owner_verified_role",
  "owner_position_title",
]);

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

/** Fields that change without content review (crop, counters, bookkeeping). */
const NOT_CONTENT_COLUMNS = new Set([
  "id",
  "owner_id",
  "status",
  "updated_at",
  "focal_x",
  "focal_y",
  "media_width",
  "media_height",
  "view_count",
  "engaged_view_count",
  "approved_edit_count",
]);

/** Stable JSON (sorted keys) so equal values compare equal. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Whether any snapshotted field differs from the live row now. */
function snapshotIsStale(
  snapshot: Record<string, unknown> | null | undefined,
  current: Record<string, unknown>
): boolean {
  if (!snapshot) return false;
  return Object.entries(snapshot).some(
    ([column, value]) =>
      !SYSTEM_CONTROLLED_COLUMNS.has(column) &&
      !NOT_CONTENT_COLUMNS.has(column) &&
      column in current &&
      stable(value) !== stable(current[column])
  );
}

async function releaseApprovalClaim({
  admin,
  requestId,
  reviewerId,
}: {
  admin: ReturnType<typeof createAdminClient>;
  requestId: string;
  reviewerId: string;
}) {
  const { error } = await admin
    .from("content_edit_requests")
    .update({ status: "pending", reviewed_by: null, reviewed_at: null })
    .eq("id", requestId)
    .eq("status", "processing")
    .eq("reviewed_by", reviewerId);

  if (error) {
    log.error("Failed to release content edit approval claim", {
      requestId,
      reviewerId,
      error: error.message,
    });
  }
}

export async function POST(request: Request) {
  // Set once this request holds the approval claim, so an unexpected error
  // releases it instead of leaving the edit stuck in "processing".
  let heldClaim: { requestId: string; reviewerId: string } | null = null;
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
    const claimItem = { type: "content_edit", id: requestId } as const;
    const claimBlock = await checkQueueClaim(guard.user.id, claimItem);
    if (claimBlock) return claimBlock;
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

    let editRequest = requestRow as ContentEditRequest;
    let config = targetConfig[editRequest.target_type];
    let contentTitle = getContentTitle(editRequest);

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
          await queuePublicMediaCleanup(
            admin,
            pendingOnlyMedia,
            "content_edit_rejected",
            editRequest.owner_id
          );
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

      await releaseDecidedClaim(guard.user.id, claimItem);
      return NextResponse.json({ success: true, decision });
    }

    // Claim the request before reading or changing the target.  This is the
    // serialization point for approve-vs-reject and concurrent approvals.
    const { data: claimedRequest, error: claimError } = await admin
      .from("content_edit_requests")
      .update({
        status: "processing",
        reviewed_by: guard.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (claimError) {
      log.error("Failed to claim content edit approval", {
        requestId,
        error: claimError.message,
      });
      return NextResponse.json({ error: "Failed to claim edit request" }, { status: 500 });
    }

    if (!claimedRequest) {
      return NextResponse.json({ error: "Edit request was already reviewed" }, { status: 409 });
    }

    heldClaim = { requestId, reviewerId: guard.user.id };
    editRequest = claimedRequest as ContentEditRequest;
    config = targetConfig[editRequest.target_type];
    contentTitle = getContentTitle(editRequest);

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
      await releaseApprovalClaim({ admin, requestId, reviewerId: guard.user.id });
      return NextResponse.json({ error: "Failed to load content item" }, { status: 500 });
    }

    if (!targetRow || targetRow.status !== "live") {
      await releaseApprovalClaim({ admin, requestId, reviewerId: guard.user.id });
      return NextResponse.json({ error: "Live content item not found" }, { status: 409 });
    }

    const approvedEditCount = Number(targetRow.approved_edit_count ?? 0);
    if (approvedEditCount >= MAX_APPROVED_CONTENT_EDITS) {
      await releaseApprovalClaim({ admin, requestId, reviewerId: guard.user.id });
      return NextResponse.json(
        {
          error: "This post has reached the maximum of two approved edits.",
          code: "edit_limit_reached",
        },
        { status: 409 }
      );
    }

    // The edit was requested against current_snapshot. If those fields have
    // changed since (the owner edited while the post was hidden, or another
    // edit was approved), applying it would overwrite newer content.
    // Contact details and addresses live in the server-only private tables;
    // compare against their real values, as the owner's snapshot did.
    const currentRow =
      config.table === "promotions"
        ? targetRow
        : (await withAllPrivateFields(config.table, [targetRow as { id: string }]))[0];
    if (snapshotIsStale(editRequest.current_snapshot, currentRow)) {
      await admin
        .from("content_edit_requests")
        .update({
          status: "rejected",
          reason: "The post changed after this edit was requested. Ask the owner to resubmit.",
        })
        .eq("id", requestId)
        .eq("status", "processing");
      return NextResponse.json(
        {
          error: "The post changed after this edit was requested, so it was closed.",
          code: "edit_superseded",
        },
        { status: 409 }
      );
    }

    // proposed_data is stored JSON applied with the service role, which skips
    // the owner guards; never let it set ownership, lifecycle, paid windows
    // or counters.
    const proposedContent = Object.fromEntries(
      Object.entries(editRequest.proposed_data ?? {}).filter(
        ([column]) => !SYSTEM_CONTROLLED_COLUMNS.has(column)
      )
    );
    const updatePayload = {
      ...proposedContent,
      status: "live",
      approved_edit_count: approvedEditCount + 1,
    };

    const { data: updatedTargets, error: updateError } = await admin
      .from(config.table)
      .update(updatePayload)
      .eq("id", editRequest.target_id)
      .eq("status", "live")
      .eq("approved_edit_count", approvedEditCount)
      .select("id");

    if (updateError) {
      log.error("Failed to apply content edit", {
        requestId,
        targetId: editRequest.target_id,
        error: updateError.message,
      });
      await releaseApprovalClaim({ admin, requestId, reviewerId: guard.user.id });
      return NextResponse.json({ error: "Failed to apply edit" }, { status: 500 });
    }

    if (!updatedTargets || updatedTargets.length === 0) {
      await releaseApprovalClaim({ admin, requestId, reviewerId: guard.user.id });
      return NextResponse.json({ error: "Edit could not be applied" }, { status: 409 });
    }

    // The edit is applied: from here a failure must not reopen the request.
    heldClaim = null;
    const { data: approvedRequests, error: markApprovedError } = await admin
      .from("content_edit_requests")
      .update({
        status: "approved",
        reason: null,
        reviewed_by: guard.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("status", "processing")
      .eq("reviewed_by", guard.user.id)
      .select("id");

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

    if (!approvedRequests || approvedRequests.length === 0) {
      log.error("Content edit target was updated but approval claim was lost", {
        requestId,
        targetId: editRequest.target_id,
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
        await queuePublicMediaCleanup(
          admin,
          removedLiveMedia,
          "content_edit_approved",
          editRequest.owner_id
        );
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
    if (heldClaim) {
      await releaseApprovalClaim({ admin: createAdminClient(), ...heldClaim }).catch(
        () => undefined
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
