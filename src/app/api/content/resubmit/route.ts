import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("ContentResubmit");

const resubmitSchema = z.object({
  itemId: z.string().uuid("itemId must be a valid UUID"),
  area: z.enum(["MZANSI_MARKET", "BUSINESS_ADS", "MALL_SHOPS", "PROMOTIONS_EVENTS"], {
    message: "area must be MZANSI_MARKET, BUSINESS_ADS, MALL_SHOPS, or PROMOTIONS_EVENTS",
  }),
});

const tableMap: Record<string, string> = {
  MZANSI_MARKET: "listings",
  BUSINESS_ADS: "business_profiles",
  MALL_SHOPS: "storefronts",
  PROMOTIONS_EVENTS: "promotions",
};

/**
 * POST /api/content/resubmit
 * Allows the seller to resubmit rejected content for moderation after editing.
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

    const rl = checkLocalRateLimit(user.id, "content:resubmit");
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

    const parsed = resubmitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { itemId, area } = parsed.data;
    const table = tableMap[area];
    if (!table) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify the item exists, belongs to this user, and is currently rejected
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

    if (item.status !== "rejected") {
      return NextResponse.json(
        { error: "Only rejected content can be resubmitted" },
        { status: 400 }
      );
    }

    // Update status to pending_moderation and clear the rejection reason
    const { error: updateError } = await admin
      .from(table)
      .update({ status: "pending_moderation", status_reason: null })
      .eq("id", itemId);

    if (updateError) {
      log.error("Failed to resubmit content", { error: updateError.message, itemId, area });
      return NextResponse.json({ error: "Failed to resubmit content" }, { status: 500 });
    }

    const targetType = table.replace(/s$/, "") as string;
    const actionMap: Record<string, string> = {
      listing: "listing_updated",
      business_profile: "business_profile_updated",
      storefront: "storefront_updated",
    };
    await logAuditEvent({
      actorId: user.id,
      actorRole: "seller",
      action: (actionMap[targetType] || "listing_updated") as Parameters<
        typeof logAuditEvent
      >[0]["action"],
      targetType,
      targetId: itemId,
      metadata: { action: "resubmit", area },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Content resubmit failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
