import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  createAnonymousViewerId,
  ENGAGEMENT_VIEWER_COOKIE,
  ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
  CONTENT_TARGET_TYPES,
} from "@/lib/engagement";
import { hashAnalyticsKey, isAutomatedUserAgent } from "@/lib/analytics/traffic-quality";
import { resolveIpGeolocation } from "@/lib/services/ip-geolocation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit, getClientIp, getClientRateLimitKey } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("EngagementViewRoute");

const viewBatchSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(CONTENT_TARGET_TYPES),
        id: uuidSchema,
        source: z.enum(["video", "page"]),
        surface: z
          .string()
          .max(40)
          .regex(/^[a-z0-9:_-]*$/i)
          .optional(),
        engaged: z.boolean().optional(),
      })
    )
    .min(1)
    .max(20),
});

const NOT_COUNTED = { ok: true, counted: [] as string[] };

/**
 * POST /api/engagement/view
 * Batched content views from every page that shows a post. The database
 * decides what counts (one per person, per post, per 30 minutes; never the
 * owner or staff; capped per network address). Best effort for visitors.
 */
export async function POST(request: NextRequest) {
  try {
    if (isAutomatedUserAgent(request.headers.get("user-agent"))) {
      return NextResponse.json(NOT_COUNTED);
    }
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const limit = checkLocalRateLimit(getClientRateLimitKey(request), "engagement:view", 120);
    if (limit.limited) return NextResponse.json(NOT_COUNTED);

    const parsed = await parseAndValidateJsonRequest(request, viewBatchSchema, {
      invalidJsonMessage: "Invalid view payload",
      validationErrorMessage: "Invalid view payload",
      includeValidationDetails: false,
    });
    if (!parsed.success) return parsed.response;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // The browser identity is issued once by the middleware; a request that
    // still lacks it gets one here. It stays the same across login/logout.
    const existingViewerId = request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
    if (!existingViewerId) {
      // Every page load sets this cookie before any view can be sent, so a
      // request without it did not come from someone browsing the site.
      const response = NextResponse.json(NOT_COUNTED);
      response.cookies.set({
        name: ENGAGEMENT_VIEWER_COOKIE,
        value: createAnonymousViewerId(),
        maxAge: ENGAGEMENT_VIEWER_COOKIE_MAX_AGE_SECONDS,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      return response;
    }
    const viewerId = existingViewerId;
    const clientIp = getClientIp(request);
    const geo = await resolveIpGeolocation().catch(() => null);

    const { data, error } = await createAdminClient().rpc("record_content_views", {
      p_events: parsed.data.events,
      p_viewer_key: `device:${viewerId}`,
      p_ip_hash: clientIp === "unknown" ? null : hashAnalyticsKey(`ip:${clientIp}`),
      p_user_id: user?.id ?? null,
      p_province: geo?.country === "ZA" ? geo.province : null,
    });

    if (error) {
      log.error("Failed to record content views", { error: error.message });
      return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      counted: Array.isArray(data) ? (data as string[]) : [],
    });
  } catch (error) {
    log.error("Unexpected engagement view error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }
}
