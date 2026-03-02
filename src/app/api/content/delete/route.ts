import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("ContentDelete");

const deleteSchema = z.object({
  itemId: z.string().uuid("itemId must be a valid UUID"),
  area: z.enum(["MZANSI_MARKET", "BUSINESS_ADS", "MALL_SHOPS"], {
    message: "area must be MZANSI_MARKET, BUSINESS_ADS, or MALL_SHOPS",
  }),
});

const tableMap: Record<string, string> = {
  MZANSI_MARKET: "listings",
  BUSINESS_ADS: "business_profiles",
  MALL_SHOPS: "storefronts",
};

/**
 * POST /api/content/delete
 * Allows the seller to permanently delete their own content.
 */
export async function POST(request: Request) {
  try {
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

    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { itemId, area } = parsed.data;
    const table = tableMap[area];
    if (!table) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify the item exists and belongs to this user
    const { data: item, error: fetchError } = await admin
      .from(table)
      .select("id, status, seller_id")
      .eq("id", itemId)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: "Content item not found" }, { status: 404 });
    }

    if (item.seller_id !== user.id) {
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
      actorRole: "seller",
      action: (actionMap[targetType] || "listing_deleted") as Parameters<
        typeof logAuditEvent
      >[0]["action"],
      targetType,
      targetId: itemId,
      metadata: { action: "seller_delete", area, previousStatus: item.status },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Content delete failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
