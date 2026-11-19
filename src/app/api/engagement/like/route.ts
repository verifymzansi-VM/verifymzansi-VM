import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CONTENT_TARGET_TYPES } from "@/lib/engagement";
import {
  engagementCaller,
  engagementClientKey,
  isCountableRequest,
  readViewerId,
} from "@/lib/engagement-route";
import { FoundationEngagementError, setFoundationPostLike } from "@/lib/foundation/post-engagement";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { SHOW_ENGAGEMENT_TOTALS } from "@/lib/hidden-features";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("EngagementLikeRoute");

const likeRequest = z.object({
  targetId: z.uuid(),
  targetType: z.enum(CONTENT_TARGET_TYPES),
  /** The state the visitor asked for; absent toggles (older pages). */
  liked: z.boolean().optional(),
});

/**
 * POST /api/engagement/like
 *
 * Anyone can like a publicly live post. Signed in, the like is the account's
 * (on any browser, with or without the browser cookie). Signed out, it is the
 * browser's: it needs the `vmz_viewer` identifier this website signed; without
 * one the route answers 428 `needs_challenge` and the page gets one from
 * /api/engagement/viewer after a Turnstile check. A like from an identifier
 * issued less than 10 minutes earlier is kept but counts only from then
 * (api.set_post_like). The database stores the account, or only a keyed hash of
 * the browser identifier; the owner's and staff's own likes are never stored.
 * Origin and CSRF checks, crawlers and headless browsers refused, and
 * per-source limits: `engagement:like` per address and `engagement:like:post`
 * per address and post a day. Answers { liked, likeCount, counted }.
 *
 * While SHOW_ENGAGEMENT_TOTALS is off the route answers 204 No Content without
 * reading the request, calling a database or setting a cookie.
 */
export async function POST(request: NextRequest) {
  if (!SHOW_ENGAGEMENT_TOTALS) return new NextResponse(null, { status: 204 });
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  if (!isCountableRequest(request))
    return NextResponse.json({ error: "Likes are not available here" }, { status: 403 });
  const parsed = likeRequest.safeParse(await parseJsonRequest(request, { maxBytes: 2048 }));
  if (!parsed.success) return NextResponse.json({ error: "Invalid like request" }, { status: 400 });

  const client = engagementClientKey(request);
  const limit = await checkRateLimit({
    key: client,
    action: "engagement:like",
    degradedMode: "local",
  });
  if (limit.limited)
    return NextResponse.json(
      { error: "Too many likes; try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );

  const [viewer, caller] = await Promise.all([readViewerId(request), engagementCaller(request)]);
  if (!caller.account && !viewer)
    return caller.respond(
      NextResponse.json(
        { error: "Confirm you are not a robot to like posts", needs_challenge: true },
        { status: 428 }
      )
    );
  // A new like (not an unlike): a few per address and post a day.
  if (parsed.data.liked !== false) {
    const perPost = await checkRateLimit({
      key: `${client}|${parsed.data.targetId}`,
      action: "engagement:like:post",
      degradedMode: "local",
    });
    if (perPost.limited)
      return caller.respond(
        NextResponse.json(
          { error: "Too many likes on this post from your network today" },
          { status: 429 }
        )
      );
  }
  try {
    const result = await setFoundationPostLike(createFoundationServiceApi(), {
      postId: parsed.data.targetId,
      // Signed in without the cookie: the account's like needs no browser.
      device: viewer?.id ?? crypto.randomUUID(),
      account: caller.account,
      liked: parsed.data.liked ?? null,
      deviceIssuedAt: caller.account ? null : (viewer?.issuedAt ?? null),
    });
    return caller.respond(
      NextResponse.json({ liked: result.liked, likeCount: result.likes, counted: result.counted })
    );
  } catch (error) {
    if (error instanceof FoundationEngagementError && error.reason === "unavailable")
      return caller.respond(
        NextResponse.json({ error: "This post is not available" }, { status: 404 })
      );
    log.error("Failed to update like", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return caller.respond(
      NextResponse.json({ error: "Unable to update like right now." }, { status: 503 })
    );
  }
}
