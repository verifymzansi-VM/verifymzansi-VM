import { NextResponse } from "next/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminContentDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { getOwnerColumn, readOwnerId } from "@/lib/account/compat";
import { createNotification } from "@/lib/notifications";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { getApprovedPostExpiryIso } from "@/lib/posting/post-lifecycle";

const log = createLogger("AdminContentDecide");

/**
 * POST /api/admin/content/decide
 * Approve or reject content pending moderation.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      rateLimitAction: "admin:content:decide",
    });
    if (!guard.success) return guard.response;

    const bodyResult = await parseAndValidateJsonRequest(request, adminContentDecideSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { itemId, area, decision, reason, contentType } = bodyResult.data;

    const admin = createAdminClient();

    // Map area to table. The validation schema only allows the three active
    // marketplace areas, so no legacy BUSINESS_ADS/MALL_SHOPS tables appear here.
    const tableMap: Record<string, string> = {
      MZANSI_MARKET: "listings",
      MZANSI_BUSINESS: "businesses",
      PROMOTIONS_EVENTS: "promotions",
    };

    const table =
      contentType === "listing"
        ? "listings"
        : contentType === "business"
          ? "businesses"
          : contentType === "promotion"
            ? "promotions"
            : tableMap[area];
    if (!table) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    const newStatus = decision === "approve" ? "live" : "rejected";

    const updatePayload: Record<string, unknown> = { status: newStatus };
    const supportsPostVisibilityDates =
      table === "listings" || table === "businesses" || table === "promotions";

    if (decision === "approve" && supportsPostVisibilityDates) {
      const approvedAt = new Date();
      const { data: pendingItem, error: pendingFetchError } = await admin
        .from(table)
        .select("id, created_at, expires_at")
        .eq("id", itemId)
        .eq("status", "pending_moderation")
        .maybeSingle();

      if (pendingFetchError) {
        return NextResponse.json({ error: "Failed to load content status" }, { status: 500 });
      }

      if (!pendingItem) {
        return NextResponse.json({ error: "Content item not found" }, { status: 404 });
      }

      updatePayload.published_at = approvedAt.toISOString();
      updatePayload.expires_at = getApprovedPostExpiryIso(
        {
          createdAt: (pendingItem as { created_at?: string | null }).created_at,
          expiresAt: (pendingItem as { expires_at?: string | null }).expires_at,
        },
        approvedAt
      );
    }

    if (decision === "reject" && reason) {
      updatePayload.status_reason = reason;
    } else if (decision === "approve") {
      updatePayload.status_reason = null;
    }

    const { data: updatedRows, error: updateError } = await admin
      .from(table)
      .update(updatePayload)
      .eq("id", itemId)
      .eq("status", "pending_moderation")
      .select("id");

    if (updateError) {
      return NextResponse.json({ error: "Failed to update content status" }, { status: 500 });
    }

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    const auditConfig: Record<
      string,
      {
        targetType: string;
        approveAction: "listing_updated" | "moderation_action";
        rejectAction: "listing_deleted" | "moderation_action";
      }
    > = {
      listings: {
        targetType: "listing",
        approveAction: "listing_updated",
        rejectAction: "listing_deleted",
      },
      businesses: {
        targetType: "business",
        approveAction: "moderation_action",
        rejectAction: "moderation_action",
      },
      promotions: {
        targetType: "promotion",
        approveAction: "moderation_action",
        rejectAction: "moderation_action",
      },
    };
    const { targetType, approveAction, rejectAction } = auditConfig[table];
    await logAuditEvent({
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      action: decision === "approve" ? approveAction : rejectAction,
      targetType,
      targetId: itemId,
      metadata: { decision, area, reason },
    });

    // Notify the account holder about the moderation decision
    try {
      // Resolve owner column via compat layer for tables that support it
      const compatTable =
        table === "listings"
          ? "listings"
          : table === "businesses"
            ? "businesses"
            : table === "promotions"
              ? "promotions"
              : null;
      const ownerField = compatTable
        ? await getOwnerColumn(admin as never, compatTable).catch(() => "owner_id")
        : "owner_id";
      const titleField = table === "businesses" ? "business_name" : "title";
      const { data: contentItem, error: contentFetchErr } = await admin
        .from(table)
        .select(`${ownerField}, ${titleField}`)
        .eq("id", itemId)
        .maybeSingle();

      if (contentFetchErr) {
        log.warn("Failed to fetch content item for notification (non-fatal)", {
          table,
          itemId,
          error: contentFetchErr.message,
        });
      }

      if (contentItem) {
        const record = contentItem as unknown as Record<string, unknown>;
        const accountHolderId = (record[ownerField] ?? readOwnerId(record)) as string;
        const contentTitle = (record[titleField] as string)?.slice(0, 40) || "your content";
        const contentLabel =
          table === "listings" ? "Listing" : table === "promotions" ? "Event" : "Business";
        const dashboardHref =
          table === "listings"
            ? "/dashboard/listings"
            : table === "promotions"
              ? "/dashboard/tourism-events"
              : "/dashboard/businesses";

        if (decision === "approve") {
          await createNotification({
            userId: accountHolderId,
            type: "success",
            title: `${contentLabel} approved!`,
            message: `"${contentTitle}" is now live and visible to buyers.`,
            href: dashboardHref,
          });
        } else {
          await createNotification({
            userId: accountHolderId,
            type: "error",
            title: `${contentLabel} rejected`,
            message: reason
              ? `"${contentTitle}" was rejected: ${reason.slice(0, 80)}`
              : `"${contentTitle}" needs changes. Check the rejection reason.`,
            href: dashboardHref,
          });
        }
      }
    } catch (notifErr) {
      log.warn("Failed to send notification (non-fatal)", {
        error: notifErr instanceof Error ? notifErr.message : "Unknown",
      });
    }

    return NextResponse.json({ success: true, decision });
  } catch (err) {
    log.error("Content decide failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
