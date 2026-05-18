import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import {
  internalApiError,
  logApiError,
  parseAndValidateJsonRequest,
  unauthorizedResponse,
  forbiddenResponse,
} from "@/lib/utils/api";
import {
  applyOwnerFilter,
  getOwnerColumn,
  type OwnerColumn,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { releaseRejectedDeletedFreePost } from "@/lib/billing/free-posts";
import { collectMediaUrls, queuePublicMediaCleanup } from "@/lib/services/media-cleanup";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import {
  contentAreaSchema,
  contentAreaTableMap,
  isOwnerCompatibleContentTable,
} from "../_lib/content-area";

const log = createLogger("ContentDelete");

const deleteSchema = z.object({
  itemId: z.string().uuid("itemId must be a valid UUID"),
  area: contentAreaSchema,
});

const targetTypeMap: Record<string, string> = {
  listings: "listing",
  businesses: "business",
  storefronts: "storefront",
  promotions: "promotion",
};

type DeletableContentItem = {
  id: string;
  status: string;
  owner_id?: string | null;
  seller_id?: string | null;
  photos?: string[] | null;
  videos?: string[] | null;
  video_thumbnail?: string | null;
  logo_url?: string | null;
  cover_photo?: string | null;
  cover_video?: string | null;
  gallery_photos?: string[] | null;
  business_details?: unknown;
};

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStringValues(item));
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      collectStringValues(item)
    );
  }

  return [];
}

function collectDeletedMediaUrls(table: string, item: DeletableContentItem): string[] {
  if (table === "businesses") {
    return collectMediaUrls(
      item.logo_url,
      item.cover_photo,
      item.cover_video,
      item.video_thumbnail,
      item.gallery_photos ?? undefined,
      collectStringValues(item.business_details)
    );
  }

  if (table === "listings" || table === "promotions") {
    return collectMediaUrls(
      item.photos ?? undefined,
      item.videos ?? undefined,
      item.video_thumbnail,
      item.logo_url
    );
  }

  return [];
}

function getDeleteSelectColumns(table: string, ownerColumn: OwnerColumn): string {
  const baseColumns = withOwnerColumn("id, status, owner_id", ownerColumn);

  if (table === "businesses") {
    return `${baseColumns}, logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, business_details`;
  }

  if (table === "listings" || table === "promotions") {
    return `${baseColumns}, photos, videos, video_thumbnail, logo_url`;
  }

  return baseColumns;
}

/**
 * POST /api/content/delete
 * Allows the account holder to permanently delete their own content.
 */
export async function POST(request: Request) {
  try {
    const mutationBlock = enforceMutationRequest(request, log);
    if (mutationBlock) return mutationBlock;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return unauthorizedResponse();
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
    const config = contentAreaTableMap[area];
    if (!config) {
      return NextResponse.json({ error: "Invalid area" }, { status: 400 });
    }

    let item: DeletableContentItem | null = null;
    let deleteErrorMessage: string | null = null;

    if (config.ownerCompatible && isOwnerCompatibleContentTable(config.table)) {
      const ownerColumn = await getOwnerColumn(supabase, config.table);
      const { data: fetchedItem, error: fetchError } = await applyOwnerFilter(
        supabase
          .from(config.table)
          .select(getDeleteSelectColumns(config.table, ownerColumn))
          .eq("id", itemId),
        ownerColumn,
        user.id
      ).maybeSingle();

      if (fetchError || !fetchedItem) {
        return NextResponse.json({ error: "Content item not found" }, { status: 404 });
      }

      const compatibleItem = fetchedItem as unknown as DeletableContentItem;
      item = compatibleItem;

      if (readOwnerId(compatibleItem) !== user.id) {
        return forbiddenResponse();
      }

      const deleteQuery = applyOwnerFilter(
        supabase.from(config.table).delete().eq("id", itemId),
        ownerColumn,
        user.id
      );
      const deleteResult = await deleteQuery;
      deleteErrorMessage =
        (deleteResult.error as unknown as { message?: string | null } | null)?.message ?? null;
    } else {
      const admin = createAdminClient();
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
        .maybeSingle();

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
        return forbiddenResponse();
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

    const deletedMediaUrls = item ? collectDeletedMediaUrls(config.table, item) : [];
    if (deletedMediaUrls.length > 0) {
      try {
        await queuePublicMediaCleanup(
          createAdminClient(),
          deletedMediaUrls,
          `${targetTypeMap[config.table] || config.table}_deleted`
        );
      } catch (cleanupError) {
        log.error("Failed to queue deleted content media for cleanup", {
          error: cleanupError instanceof Error ? cleanupError.message : "Unknown",
          itemId,
          area,
        });
      }
    }

    if (item?.status === "rejected") {
      try {
        await releaseRejectedDeletedFreePost(createAdminClient(), user.id, area, itemId);
      } catch (releaseError) {
        log.error("Failed to release rejected free post claim after delete", {
          error: releaseError instanceof Error ? releaseError.message : "Unknown",
          itemId,
          area,
          userId: user.id,
        });
      }
    }

    const targetType = targetTypeMap[config.table] || config.table;
    const actionMap: Record<string, string> = {
      listing: "listing_deleted",
      business: "business_profile_deleted",
      storefront: "storefront_deleted",
      promotion: "listing_deleted",
    };
    try {
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
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Content delete failed", error);
    return internalApiError();
  }
}
