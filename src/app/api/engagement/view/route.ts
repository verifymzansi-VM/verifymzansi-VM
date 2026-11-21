import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CONTENT_TARGET_TYPES } from "@/lib/engagement";
import {
  engagementCaller,
  engagementClientKey,
  isCountableRequest,
  readViewerId,
} from "@/lib/engagement-route";
import { recordFoundationPostViews } from "@/lib/foundation/post-engagement";
import { recordFoundationPostActivity } from "@/lib/foundation/post-performance";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { SHOW_ENGAGEMENT_TOTALS } from "@/lib/hidden-features";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("EngagementViewRoute");

const viewBatch = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(CONTENT_TARGET_TYPES),
        id: z.uuid(),
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

/** Page views one request may count: a browser sends a post's view once it
 * has been on screen for 2 seconds, so a real batch holds one or two. */
const MAX_PAGE_VIEWS = 3;

const notCounted = () => NextResponse.json({ ok: true, counted: [] as string[] });

/**
 * POST /api/engagement/view
 *
 * Views from the pages that show a post. A view counts only when a browser
 * had the post's own page (or the full-screen viewer on it) visible for 2
 * seconds (src/hooks/use-track-content-view.ts, use-dwell-view.ts): events
 * with source "page", at most three per request. Video plays on cards are not
 * views. Never counted: a crawler or headless browser, a prefetch, a browser
 * without an identifier this website signed (it is told `needs_challenge` and
 * gets one from /api/engagement/viewer after a Turnstile check), or views over
 * the per-source limits (`engagement:view` per address, `engagement:view:post`
 * per address and post a day), so a flood from a few sources only uses up
 * their own allowance. The database counts a post at most once per browser in
 * 24 hours and never the owner's or staff views (api.record_post_views).
 *
 * While SHOW_ENGAGEMENT_TOTALS is off the route answers 204 No Content without
 * reading the request, calling a database or setting a cookie.
 */
export async function POST(request: NextRequest) {
  if (!SHOW_ENGAGEMENT_TOTALS) return new NextResponse(null, { status: 204 });
  const blocked = enforceSameOriginMutation(request, log);
  if (blocked) return blocked;
  if (!isCountableRequest(request)) return notCounted();
  const parsed = viewBatch.safeParse(await parseJsonRequest(request, { maxBytes: 8192 }));
  if (!parsed.success) return NextResponse.json({ error: "Invalid view payload" }, { status: 400 });
  const pageViews = [
    ...new Set(parsed.data.events.filter((e) => e.source === "page").map((e) => e.id)),
  ].slice(0, MAX_PAGE_VIEWS);
  // Engaged video views (30 seconds, or 90% of a shorter video): counted for
  // the owner's Performance page only, once the post's view was counted.
  const engaged = [
    ...new Set(
      parsed.data.events.filter((e) => e.source === "video" && e.engaged).map((e) => e.id)
    ),
  ].slice(0, MAX_PAGE_VIEWS);
  if (pageViews.length === 0 && engaged.length === 0) return notCounted();

  const viewer = await readViewerId(request);
  if (!viewer)
    return NextResponse.json({ ok: true, counted: [] as string[], needs_challenge: true });

  const client = engagementClientKey(request);
  const limit = await checkRateLimit({
    key: client,
    action: "engagement:view",
    degradedMode: "local",
  });
  if (limit.limited) return notCounted();
  // Each post: at most a few counted views per address and day.
  const allowed = (
    await Promise.all(
      pageViews.map(async (id) => {
        const perPost = await checkRateLimit({
          key: `${client}|${id}`,
          action: "engagement:view:post",
          degradedMode: "local",
        });
        return perPost.limited ? null : id;
      })
    )
  ).filter((id): id is string => id !== null);
  if (allowed.length === 0 && engaged.length === 0) return notCounted();

  const caller = await engagementCaller(request);
  try {
    const service = createFoundationServiceApi();
    const counted =
      allowed.length === 0
        ? []
        : await recordFoundationPostViews(service, {
            postIds: allowed,
            device: viewer.id,
            account: caller.account,
            deviceIssuedAt: viewer.issuedAt,
          });
    // After the views, so a view and its engaged signal in one request count
    // in that order.
    if (engaged.length > 0)
      await recordFoundationPostActivity(service, {
        events: engaged.map((postId) => ({ postId, counter: "engaged_views" as const })),
        device: viewer.id,
        account: caller.account,
      });
    return caller.respond(NextResponse.json({ ok: true, counted }));
  } catch (error) {
    log.error("Failed to record post views", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return caller.respond(
      NextResponse.json({ error: "Views are temporarily unavailable" }, { status: 503 })
    );
  }
}
