import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { buildViewerKey, ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import { COMMERCIAL_EVENT_TYPES } from "@/lib/analytics/commercial-events";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("CommercialAnalytics");

const schema = z.object({
  events: z
    .array(
      z.object({
        table: z.enum(["listings", "businesses", "promotions", "organisations"]),
        id: z.uuid(),
        type: z.enum(COMMERCIAL_EVENT_TYPES),
        surface: z.string().max(40).optional(),
        source: z.string().max(40).optional(),
      })
    )
    .min(1)
    .max(50),
});

/** Hash the viewer key so stored analytics cannot be linked back to a visitor. */
function hashViewer(viewerKey: string): string {
  const secret = process.env.IP_HASH_SECRET || process.env.HMAC_SECRET || "vm-analytics";
  return createHash("sha256").update(`${secret}:${viewerKey}`).digest("hex").slice(0, 40);
}

/**
 * POST /api/analytics/events
 * Batched impressions, detail views and contact actions for commercial
 * reporting. Best effort: failures never surface to visitors.
 */
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("dnt") === "1") return NextResponse.json({ ok: true, recorded: 0 });
    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) return originBlock;

    const limit = checkLocalRateLimit(getClientRateLimitKey(request), "analytics:events", 120);
    if (limit.limited) return NextResponse.json({ ok: true, recorded: 0 });

    const parsed = await parseAndValidateJsonRequest(request, schema, {
      invalidJsonMessage: "Invalid analytics payload",
      validationErrorMessage: "Invalid analytics payload",
      includeValidationDetails: false,
    });
    if (!parsed.success) return parsed.response;

    const viewerId = request.cookies.get(ENGAGEMENT_VIEWER_COOKIE)?.value ?? null;
    const viewerKey = buildViewerKey(viewerId) ?? `ip:${getClientRateLimitKey(request)}`;

    const { data, error } = await createAdminClient().rpc("record_analytics_events", {
      p_events: parsed.data.events,
      p_viewer_key: hashViewer(viewerKey),
    });
    if (error) {
      log.warn("Analytics events not recorded", { code: error.code });
      return NextResponse.json({ ok: true, recorded: 0 });
    }
    return NextResponse.json({ ok: true, recorded: typeof data === "number" ? data : 0 });
  } catch (error) {
    log.warn("Analytics route error", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ ok: true, recorded: 0 });
  }
}
