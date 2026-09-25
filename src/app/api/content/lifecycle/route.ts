import { NextResponse } from "next/server";
import { z } from "zod";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { uuidSchema } from "@/lib/validations/shared";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { mapCommercialError } from "@/lib/commercial/errors";

const log = createLogger("ContentLifecycle");

const CONTENT_TABLES = {
  listing: "listings",
  business: "businesses",
  promotion: "promotions",
} as const;

const lifecycleSchema = z.object({
  contentType: z.enum(["listing", "business", "promotion"]),
  id: uuidSchema,
  action: z.enum(["mark_sold", "deactivate", "reactivate"]),
});

/**
 * POST /api/content/lifecycle
 * Owner slot actions: mark sold / deactivate (frees the posting slot) and
 * reactivate saved content (uses a slot; unchanged approved content goes
 * straight back live). All rules run in the `owner_content_action` RPC.
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await parseAndValidateJsonRequest(request, lifecycleSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;
    const { contentType, id, action } = body.data;

    const rl = checkLocalRateLimit(`${user.id}:${id}`, "content:lifecycle", 5);
    if (rl.limited) {
      return NextResponse.json(
        { error: "Please wait a moment before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 30) } }
      );
    }

    const { data, error } = await createAdminClient().rpc("owner_content_action", {
      p_user: user.id,
      p_table: CONTENT_TABLES[contentType],
      p_content: id,
      p_action: action,
    });

    if (error) {
      const mapped = mapCommercialError(error.message);
      if (mapped) {
        return NextResponse.json(
          {
            error: mapped.message,
            code: mapped.code,
            ...(mapped.status === 402 ? { upgradeUrl: "/pricing" } : {}),
          },
          { status: mapped.status }
        );
      }
      log.error("Content lifecycle action failed", {
        userId: user.id,
        id,
        action,
        error: error.message,
      });
      return NextResponse.json({ error: "Unable to update this post" }, { status: 500 });
    }

    await logAuditEvent({
      actorId: user.id,
      actorRole: "owner",
      action: "content_lifecycle_changed",
      targetType: contentType,
      targetId: id,
      metadata: { action, status: data },
    });

    return NextResponse.json({ status: data });
  } catch (error) {
    log.error("Content lifecycle route error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
