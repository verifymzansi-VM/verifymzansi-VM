import { NextResponse } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { adminContentDecideSchema } from "@/lib/validations/admin";
import { createLogger } from "@/lib/utils/logger";
import { verifyStaffActorRoleFromDb } from "@/lib/auth/admin-access";
import { getOwnerColumn, readOwnerId } from "@/lib/account/compat";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createNotification } from "@/lib/notifications";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";

const log = createLogger("AdminContentDecide");

/**
 * POST /api/admin/content/decide
 * Approve or reject content pending moderation.
 */
export async function POST(request: Request) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adminRole = await verifyStaffActorRoleFromDb(user);
    if (!adminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:content:decide");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = adminContentDecideSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { itemId, area, decision, reason } = parsed.data;

    const admin = createAdminClient();

    // Map area to table
    const tableMap: Record<string, string> = {
      MZANSI_MARKET: "listings",
      BUSINESS_ADS: "business_profiles",
      MALL_SHOPS: "storefronts",
      MZANSI_BUSINESS: "businesses",
      PROMOTIONS_EVENTS: "promotions",
    };

    const table = tableMap[area];
    if (!table) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    const newStatus = decision === "approve" ? "live" : "rejected";

    const updatePayload: Record<string, unknown> = { status: newStatus };
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
        approveAction:
          | "listing_updated"
          | "business_profile_updated"
          | "storefront_updated"
          | "moderation_action";
        rejectAction:
          | "listing_deleted"
          | "business_profile_deleted"
          | "storefront_deleted"
          | "moderation_action";
      }
    > = {
      listings: {
        targetType: "listing",
        approveAction: "listing_updated",
        rejectAction: "listing_deleted",
      },
      business_profiles: {
        targetType: "business_profile",
        approveAction: "business_profile_updated",
        rejectAction: "business_profile_deleted",
      },
      storefronts: {
        targetType: "storefront",
        approveAction: "storefront_updated",
        rejectAction: "storefront_deleted",
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
      actorId: user.id,
      actorRole: adminRole,
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
      const titleField =
        table === "listings"
          ? "title"
          : table === "storefronts"
            ? "mall_name"
            : table === "promotions"
              ? "title"
              : "business_name";
      const { data: contentItem } = await admin
        .from(table)
        .select(`${ownerField}, ${titleField}`)
        .eq("id", itemId)
        .single();

      if (contentItem) {
        const record = contentItem as unknown as Record<string, unknown>;
        const accountHolderId = (record[ownerField] ?? readOwnerId(record)) as string;
        const contentTitle = (record[titleField] as string)?.slice(0, 40) || "your content";
        const contentLabel =
          table === "listings"
            ? "Listing"
            : table === "storefronts"
              ? "Storefront"
              : table === "promotions"
                ? "Promotion"
                : table === "business_profiles"
                  ? "Business profile"
                  : "Business";
        const dashboardHref =
          table === "listings"
            ? "/dashboard/listings"
            : table === "storefronts"
              ? "/dashboard/storefronts"
              : table === "promotions"
                ? "/dashboard/promotions"
                : table === "business_profiles"
                  ? "/dashboard/business-profiles"
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
