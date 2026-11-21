import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { COMMERCIAL_EVENT_TYPES } from "@/lib/analytics/commercial-events";
import { engagementCaller, engagementClientKey, isCountableRequest } from "@/lib/engagement-route";
import {
  activityCounter,
  MAX_ACTIVITY_EVENTS,
  recordFoundationPostActivity,
  type ActivityCounter,
} from "@/lib/foundation/post-performance";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { SHOW_ENGAGEMENT_TOTALS } from "@/lib/hidden-features";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("AnalyticsEventsRoute");

const eventBatch = z.object({
  events: z
    .array(
      z.object({
        table: z.enum(["listings", "businesses", "promotions", "organisations"]),
        id: z.uuid(),
        type: z.enum(COMMERCIAL_EVENT_TYPES),
        surface: z
          .string()
          .max(40)
          .regex(/^[a-z0-9:_-]*$/i)
          .optional(),
        source: z.enum(["internal", "search", "social", "referral"]).optional(),
      })
    )
    .min(1)
    .max(MAX_ACTIVITY_EVENTS),
});

const accepted = () => new NextResponse(null, { status: 204 });

/**
 * POST /api/analytics/events
 *
 * The events pages send for the owner's Performance page
 * (src/lib/analytics/commercial-events.ts, a beacon every few seconds):
 * a post's card seen in a list, search, the home page, a showroom or an
 * organisation page (half the card on screen for a second), its own page
 * opened (with where the visitor came from), a WhatsApp, phone, website,
 * directions, booking or ticket tap, and a share. Each is added to the post's
 * counters for the day (api.record_post_activity); a save (the page shows
 * likes), a sponsor click and organisation events are not counted here.
 *
 * No sign-in or cookie needed. Never counted: a crawler or headless browser,
 * a prefetch, requests over the per-source limit (`engagement:activity` per
 * IPv4 address or IPv6 /48), and (in the database) the signed-in owner's own
 * events, staff events and posts that are not publicly live. Nothing about
 * the visitor is sent to the database except the GoTrue-verified account,
 * which only decides whether the event counts.
 *
 * While SHOW_ENGAGEMENT_TOTALS is off the route answers 204 No Content without
 * reading the request, calling a database or setting a cookie.
 */
export async function POST(request: NextRequest) {
  if (!SHOW_ENGAGEMENT_TOTALS) return accepted();
  const blocked = enforceSameOriginMutation(request, log);
  if (blocked) return blocked;
  if (!isCountableRequest(request)) return accepted();
  const parsed = eventBatch.safeParse(await parseJsonRequest(request, { maxBytes: 16384 }));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid event payload" }, { status: 400 });
  const events = parsed.data.events.flatMap((event) => {
    if (event.table === "organisations") return [];
    const counter = activityCounter(event);
    return counter
      ? [{ postId: event.id, counter } as { postId: string; counter: ActivityCounter }]
      : [];
  });
  if (events.length === 0) return accepted();

  const limit = await checkRateLimit({
    key: engagementClientKey(request),
    action: "engagement:activity",
    degradedMode: "local",
  });
  if (limit.limited) return accepted();

  const caller = await engagementCaller(request);
  try {
    await recordFoundationPostActivity(createFoundationServiceApi(), {
      events,
      device: null,
      account: caller.account,
    });
    return caller.respond(accepted());
  } catch (error) {
    log.error("Failed to record post activity", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return caller.respond(
      NextResponse.json({ error: "Statistics are temporarily unavailable" }, { status: 503 })
    );
  }
}
