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

/** Events of a post's own page: a detail view (by source), a tap or a share. */
const isPageEvent = (counter: ActivityCounter) => /^views_|_taps$|^shares$/.test(counter);

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
 * No sign-in or cookie needed. Each (post, counter) pair counts at most once
 * per request. Never counted: a crawler or headless browser, a prefetch,
 * requests over the per-source limit (`engagement:activity` per IPv4 address
 * or IPv6 /48), a post's page events (detail views, taps, shares) over its
 * per-source daily limit (`engagement:activity:post`, one per request with
 * such an event for the post; dropped silently; appearances are not checked
 * against it, so a page left open never uses it up), and (in the database) the
 * signed-in owner's own
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
  // Each (post, counter) pair once per request.
  const pairs = new Map<string, { postId: string; counter: ActivityCounter }>();
  for (const event of parsed.data.events) {
    const counter = event.table === "organisations" ? null : activityCounter(event);
    if (counter) pairs.set(`${event.id}|${counter}`, { postId: event.id, counter });
  }
  if (pairs.size === 0) return accepted();

  const client = engagementClientKey(request);
  const limit = await checkRateLimit({
    key: client,
    action: "engagement:activity",
    degradedMode: "local",
  });
  if (limit.limited) return accepted();
  // Each post's page events (detail views, taps, shares): at most a few hundred
  // requests per address and day. Appearances come many posts at a time and
  // rely on the per-request dedupe and the address limit above.
  const posts = [
    ...new Set(
      [...pairs.values()].filter((pair) => isPageEvent(pair.counter)).map((pair) => pair.postId)
    ),
  ];
  const allowed = new Set(
    (
      await Promise.all(
        posts.map(async (id) => {
          const perPost = await checkRateLimit({
            key: `${client}|${id}`,
            action: "engagement:activity:post",
            degradedMode: "local",
          });
          return perPost.limited ? null : id;
        })
      )
    ).filter((id): id is string => id !== null)
  );
  const events = [...pairs.values()].filter(
    (pair) => !isPageEvent(pair.counter) || allowed.has(pair.postId)
  );
  if (events.length === 0) return accepted();

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
