import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

import { applyOwnerFilter, getOwnerColumn, withOwnerColumn } from "@/lib/account/compat";
import { logAuditEvent } from "@/lib/services/audit";
import { queuePublicMediaCleanup } from "@/lib/services/media-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseAndValidateRouteParams } from "@/lib/utils/api";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import type { AppLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

type DeleteRouteConfig<Params extends Record<string, string>, ExistingRow> = {
  log: AppLogger;
  paramsSchema: ZodType<Params>;
  validationErrorMessage: string;
  table: "businesses" | "promotions";
  ownerSelect: string;
  rateLimitKey: string;
  notFoundMessage: string;
  invalidStatusMessage: string;
  deleteErrorMessage: string;
  deleteErrorLogMessage: string;
  cleanupReason: string;
  cleanupErrorLogMessage: string;
  cleanupErrorIdKey: "businessId" | "promotionId";
  auditTargetType: "business" | "promotion";
  auditArea?: string;
  getEntityId: (params: Params) => string;
  canDelete: (existing: ExistingRow) => boolean;
  collectDeletedMediaUrls: (existing: ExistingRow) => string[];
};

export function createOwnedContentDeleteRoute<Params extends Record<string, string>, ExistingRow>({
  log,
  paramsSchema,
  validationErrorMessage,
  table,
  ownerSelect,
  rateLimitKey,
  notFoundMessage,
  invalidStatusMessage,
  deleteErrorMessage,
  deleteErrorLogMessage,
  cleanupReason,
  cleanupErrorLogMessage,
  cleanupErrorIdKey,
  auditTargetType,
  auditArea,
  getEntityId,
  canDelete,
  collectDeletedMediaUrls,
}: DeleteRouteConfig<Params, ExistingRow>) {
  return async function DELETE(request: NextRequest, { params }: { params: Promise<Params> }) {
    try {
      const originBlock = enforceSameOriginMutation(request, log);
      if (originBlock) return originBlock;

      const csrfBlock = enforceCsrfToken(request, log);
      if (csrfBlock) return csrfBlock;

      const parsedParams = parseAndValidateRouteParams(await params, paramsSchema, {
        validationErrorMessage,
        includeValidationDetails: false,
      });
      if (!parsedParams.success) {
        return parsedParams.response;
      }

      const entityId = getEntityId(parsedParams.data);
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const rl = checkLocalRateLimit(user.id, rateLimitKey);
      if (rl.limited) {
        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
        );
      }

      const ownerColumn = await getOwnerColumn(supabase, table);
      const { data: rawExisting } = await applyOwnerFilter(
        supabase.from(table).select(withOwnerColumn(ownerSelect, ownerColumn)).eq("id", entityId),
        ownerColumn,
        user.id
      ).maybeSingle();
      const existing = rawExisting as ExistingRow | null;

      if (!existing) {
        return NextResponse.json({ error: notFoundMessage }, { status: 404 });
      }

      if (!canDelete(existing)) {
        return NextResponse.json({ error: invalidStatusMessage }, { status: 400 });
      }

      const { error: deleteError } = await applyOwnerFilter(
        supabase.from(table).delete().eq("id", entityId),
        ownerColumn,
        user.id
      );

      if (deleteError) {
        log.error(deleteErrorLogMessage, { error: deleteError.message });
        return NextResponse.json({ error: deleteErrorMessage }, { status: 500 });
      }

      const deletedMediaUrls = collectDeletedMediaUrls(existing);
      if (deletedMediaUrls.length > 0) {
        try {
          const admin = createAdminClient();
          await queuePublicMediaCleanup(admin, deletedMediaUrls, cleanupReason);
        } catch (cleanupError) {
          log.error(cleanupErrorLogMessage, {
            error: cleanupError instanceof Error ? cleanupError.message : "Unknown error",
            [cleanupErrorIdKey]: entityId,
          });
        }
      }

      try {
        await logAuditEvent({
          actorId: user.id,
          actorRole: "member",
          action: "listing_deleted",
          targetType: auditTargetType,
          targetId: entityId,
          ...(auditArea ? { area: auditArea } : {}),
        });
      } catch {
        // non-fatal
      }

      return NextResponse.json({ success: true });
    } catch (err) {
      log.error("Unexpected error", {
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined,
      });
      return NextResponse.json({ error: deleteErrorMessage }, { status: 500 });
    }
  };
}
