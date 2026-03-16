import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import {
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";

const log = createLogger("ContentDelete");

const deleteSchema = z.object({
  itemId: z.string().uuid("itemId must be a valid UUID"),
  area: z.enum(
    ["MZANSI_MARKET", "MZANSI_BUSINESS", "BUSINESS_ADS", "MALL_SHOPS", "PROMOTIONS_EVENTS"],
    {
      message:
        "area must be MZANSI_MARKET, MZANSI_BUSINESS, BUSINESS_ADS, MALL_SHOPS, or PROMOTIONS_EVENTS",
    }
  ),
});

const tableMap = {
  MZANSI_MARKET: { table: "listings", ownerCompatible: true },
  MZANSI_BUSINESS: { table: "businesses", ownerCompatible: true },
  BUSINESS_ADS: { table: "businesses", ownerCompatible: true },
  MALL_SHOPS: { table: "storefronts", ownerCompatible: false },
  PROMOTIONS_EVENTS: { table: "promotions", ownerCompatible: true },
} as const;

type TableConfig = (typeof tableMap)[keyof typeof tableMap];
type CompatibleTable = "listings" | "businesses" | "promotions";

function isOwnerCompatibleTable(table: TableConfig["table"]): table is CompatibleTable {
  return table === "listings" || table === "businesses" || table === "promotions";
}

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
    const config = tableMap[area];
    if (!config) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    const admin = createAdminClient();

    let item: {
      id: string;
      status: string;
      owner_id?: string | null;
      seller_id?: string | null;
    } | null = null;
    let deleteErrorMessage: string | null = null;

    if (config.ownerCompatible && isOwnerCompatibleTable(config.table)) {
      const ownerColumn = await getOwnerColumn(admin, config.table);
      const { data: fetchedItem, error: fetchError } = await admin
        .from(config.table)
        .select(withOwnerColumn("id, status, owner_id", ownerColumn))
        .eq("id", itemId)
        .maybeSingle();

      if (fetchError || !fetchedItem) {
        return NextResponse.json({ error: "Content item not found" }, { status: 404 });
      }

      const compatibleItem = fetchedItem as unknown as {
        id: string;
        status: string;
        owner_id?: string | null;
        seller_id?: string | null;
      };
      item = compatibleItem;

      if (readOwnerId(compatibleItem) !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const deleteQuery = applyOwnerFilter(
        admin.from(config.table).delete().eq("id", itemId),
        ownerColumn,
        user.id
      );
      const deleteResult = await deleteQuery;
      deleteErrorMessage =
        (deleteResult.error as unknown as { message?: string | null } | null)?.message ?? null;
    } else {
      // Storefronts (MALL_SHOPS) — probe owner column since the table
      // may use owner_id or seller_id depending on migration state.
      let storefrontOwnerCol: "owner_id" | "seller_id" = "owner_id";
      try {
        const probe = await admin.from(config.table).select("id, owner_id").limit(1);
        if ((probe.error as unknown as { code?: string } | null)?.code === "42703") {
          storefrontOwnerCol = "seller_id";
        }
      } catch {
        // Fall back to owner_id
      }

      const selectCols = `id, status, ${storefrontOwnerCol}`;
      const { data: fetchedItem, error: fetchError } = await admin
        .from(config.table)
        .select(selectCols)
        .eq("id", itemId)
        .single();

      if (fetchError || !fetchedItem) {
        return NextResponse.json({ error: "Content item not found" }, { status: 404 });
      }

      const typedItem = fetchedItem as unknown as Record<string, unknown>;
      item = {
        id: typedItem.id as string,
        status: typedItem.status as string,
        owner_id: (typedItem.owner_id ?? typedItem.seller_id ?? null) as string | null,
      };

      if (item.owner_id !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const deleteResult = await admin
        .from(config.table)
        .delete()
        .eq("id", itemId)
        .eq(storefrontOwnerCol, user.id);
      deleteErrorMessage =
        (deleteResult.error as unknown as { message?: string | null } | null)?.message ?? null;
    }

    if (deleteErrorMessage) {
      log.error("Failed to delete content", { error: deleteErrorMessage, itemId, area });
      return NextResponse.json({ error: "Failed to delete content" }, { status: 500 });
    }

    const targetType = config.table.replace(/s$/, "") as string;
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
      metadata: { action: "account_delete", area, previousStatus: item?.status ?? null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Content delete failed", error);
    return internalApiError();
  }
}
