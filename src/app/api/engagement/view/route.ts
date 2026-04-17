import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createLogger } from "@/lib/utils/logger";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";
import {
  buildViewerKey,
  createAnonymousViewerId,
  ENGAGEMENT_VIEWER_COOKIE,
  ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
  isContentTargetType,
} from "@/lib/engagement";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("EngagementViewRoute");

const viewRequestSchema = z.object({
  targetId: uuidSchema,
  targetType: z.string().refine(isContentTargetType, "Invalid target type"),
});

export async function POST(request: NextRequest) {
  try {
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }

    const parsedBody = await parseAndValidateJsonRequest(request, viewRequestSchema, {
      invalidJsonMessage: "Invalid engagement payload",
      validationErrorMessage: "Invalid engagement payload",
      includeValidationDetails: false,
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const rateLimit = checkLocalRateLimit(getClientRateLimitKey(request), "engagement:view", 120);
    if (rateLimit.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) },
        }
      );
    }

    const { targetId, targetType } = parsedBody.data;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const existingViewerId = request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
    const nextViewerId = existingViewerId ?? createAnonymousViewerId();
    const viewerKey = buildViewerKey(nextViewerId, user?.id);

    if (!viewerKey) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_content_view", {
      p_target_id: targetId,
      p_target_type: targetType,
      p_viewer_key: viewerKey,
      p_viewer_user_id: user?.id ?? null,
      p_viewer_ip_hash: null,
    });

    if (error) {
      log.error("Failed to record content view", {
        targetId,
        targetType,
        error: error.message,
      });
      return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
    }

    const response = NextResponse.json({ ok: true, recorded: Boolean(data) });
    if (!existingViewerId) {
      response.cookies.set({
        name: ENGAGEMENT_VIEWER_COOKIE,
        value: nextViewerId,
        maxAge: ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }

    return response;
  } catch (error) {
    log.error("Unexpected engagement view error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }
}
