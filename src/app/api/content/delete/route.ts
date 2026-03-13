import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("ContentDelete");

const deleteSchema = z.object({
  itemId: z.string().uuid("itemId must be a valid UUID"),
  area: z.enum(["MZANSI_MARKET", "BUSINESS_ADS", "MALL_SHOPS", "PROMOTIONS_EVENTS"], {
    message: "area must be MZANSI_MARKET, BUSINESS_ADS, MALL_SHOPS, or PROMOTIONS_EVENTS",
  }),
});

const tableMap: Record<string, string> = {
  MZANSI_MARKET: "listings",
  BUSINESS_ADS: "businesses",
  MALL_SHOPS: "storefronts",
  PROMOTIONS_EVENTS: "promotions",
};

/**
 * POST /api/content/delete
 * Allows the account holder to permanently delete their own content.
 */
export async function POST(request: Request) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) {
      return sameOriginFailure;
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "content:delete");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, deleteSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });

    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const { itemId, area } = parsedBody.data;
    const table = tableMap[area];
    if (!table) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify the item exists and belongs to this user
    const { data: item, error: fetchError } = await admin
      .from(table)
      .select("id, status, owner_id")
      .eq("id", itemId)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    if (item.owner_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete the item
    const { error: deleteError } = await admin.from(table).delete().eq("id", itemId);

    if (deleteError) {
      log.error("Failed to delete content", { error: deleteError.message, itemId, area });
      return NextResponse.json({ error: "Failed to delete content" }, { status: 500 });
    }

    const targetType = table.replace(/s$/, "") as string;
    const actionMap: Record<string, string> = {
      listing: "listing_deleted",
      business_profile: "business_profile_deleted",
      storefront: "storefront_deleted",
    };
    await logAuditEvent({
      actorId: user.id,
      actorRole: "member",
      action: (actionMap[targetType] || "listing_deleted") as Parameters<
        typeof logAuditEvent
      >[0]["action"],
      targetType,
      targetId: itemId,
      metadata: { action: "account_delete", area, previousStatus: item.status },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Content delete failed", error);
    return internalApiError();
  }
}
