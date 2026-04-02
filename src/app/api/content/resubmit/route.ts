import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import {
  applyOwnerFilter,
  getOwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";

import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("ContentResubmit");

const resubmitSchema = z.object({
  itemId: uuidSchema,
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
type NonCompatibleFetchedItem = {
  id: string;
  status: string;
  owner_id?: string | null;
  seller_id?: string | null;
};

function isOwnerCompatibleTable(table: TableConfig["table"]): table is CompatibleTable {
  return table === "listings" || table === "businesses" || table === "promotions";
}

/**
 * POST /api/content/resubmit
 * Allows the account holder to resubmit rejected content for moderation after editing.
 */
export async function POST(request: Request) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) return sameOriginFailure;
    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) return csrfBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const bodyResult = await parseAndValidateJsonRequest(request, resubmitSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!bodyResult.success) {
      return bodyResult.response;
    }

    const { itemId, area } = bodyResult.data;

    // Rate-limit resubmits per user+item to prevent unchanged-content spam (#46)
    const rl = checkLocalRateLimit(`${user.id}:${itemId}`, "content:resubmit", 1);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Please edit your content before resubmitting. Try again shortly." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const config = tableMap[area];
    if (!config) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    let item: {
      id: string;
      status: string;
      owner_id?: string | null;
      seller_id?: string | null;
    } | null = null;
    let updateErrorMessage: string | null = null;

    if (config.ownerCompatible && isOwnerCompatibleTable(config.table)) {
      const ownerColumn = await getOwnerColumn(supabase, config.table);
      const { data: fetchedItem, error: fetchError } = await applyOwnerFilter(
        supabase
          .from(config.table)
          .select(withOwnerColumn("id, status, owner_id", ownerColumn))
          .eq("id", itemId),
        ownerColumn,
        user.id
      ).maybeSingle();

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

      if (compatibleItem.status !== "rejected") {
        return NextResponse.json(
          { error: "Only rejected content can be resubmitted" },
          { status: 400 }
        );
      }

      const updateQuery = applyOwnerFilter(
        supabase
          .from(config.table)
          .update({ status: "pending_moderation", status_reason: null })
          .eq("id", itemId),
        ownerColumn,
        user.id
      );

      const updateResult = await updateQuery;
      updateErrorMessage =
        (updateResult.error as unknown as { message?: string | null } | null)?.message ?? null;
    } else {
      const admin = createAdminClient();
      // Detect owner column for tables not in the standard compat list (e.g. storefronts)
      let ownerCol = "owner_id";
      try {
        const probe = await admin.from(config.table).select("id, owner_id").limit(1);
        if ((probe.error as unknown as { code?: string } | null)?.code === "42703") {
          ownerCol = "seller_id";
        }
      } catch {
        // fall back to owner_id
      }

      const { data: fetchedItem, error: fetchError } = await admin
        .from(config.table)
        .select(`id, status, ${ownerCol}`)
        .eq("id", itemId)
        .maybeSingle();

      if (fetchError || !fetchedItem) {
        return NextResponse.json({ error: "Content item not found" }, { status: 404 });
      }

      const normalizedItem = fetchedItem as unknown as NonCompatibleFetchedItem;
      const fetchedOwner = readOwnerId(normalizedItem);
      item = { id: normalizedItem.id, status: normalizedItem.status, owner_id: fetchedOwner };

      if (!item || fetchedOwner !== user.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (item.status !== "rejected") {
        return NextResponse.json(
          { error: "Only rejected content can be resubmitted" },
          { status: 400 }
        );
      }

      const updateResult = await admin
        .from(config.table)
        .update({ status: "pending_moderation", status_reason: null })
        .eq("id", itemId);
      updateErrorMessage =
        (updateResult.error as unknown as { message?: string | null } | null)?.message ?? null;
    }

    if (updateErrorMessage) {
      log.error("Failed to resubmit content", { error: updateErrorMessage, itemId, area });
      return NextResponse.json({ error: "Failed to resubmit content" }, { status: 500 });
    }

    const targetTypeMap: Record<string, string> = {
      listings: "listing",
      businesses: "business",
      storefronts: "storefront",
      promotions: "promotion",
    };
    const targetType = targetTypeMap[config.table] || config.table;
    const actionMap: Record<string, string> = {
      listing: "listing_updated",
      business: "business_profile_updated",
      storefront: "storefront_updated",
      promotion: "listing_updated",
    };
    try {
      await logAuditEvent({
        actorId: user.id,
        actorRole: "member",
        action: (actionMap[targetType] || "listing_updated") as Parameters<
          typeof logAuditEvent
        >[0]["action"],
        targetType,
        targetId: itemId,
        metadata: { action: "resubmit", area },
      });
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error("Content resubmit failed", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
