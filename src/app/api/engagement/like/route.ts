import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CONTENT_TARGET_TYPES } from "@/lib/engagement";
import {
  engagementCaller,
  isCountableRequest,
  issueViewerId,
  readViewerId,
} from "@/lib/engagement-route";
import { FoundationEngagementError, setFoundationPostLike } from "@/lib/foundation/post-engagement";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { SHOW_ENGAGEMENT_TOTALS } from "@/lib/hidden-features";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";

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
 * Anyone can like a publicly live post, signed in or not: one like per
 * browser (the `vmz_viewer` cookie, issued here when missing) and per account
 * when signed in, which the database stores only as a keyed hash of the
 * browser identifier plus the account (api.set_post_like). The owner's own
 * like is never stored. Origin and CSRF checks, crawlers and headless browsers
 * refused, a per-address limit (engagement:like) and a per-post limit in the
 * database. Answers { liked, likeCount, counted }.
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

  const limit = await checkRateLimit({
    key: getClientRateLimitIdentity(request).key,
    action: "engagement:like",
    degradedMode: "local",
  });
  if (limit.limited)
    return NextResponse.json(
      { error: "Too many likes; try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );

  const existing = readViewerId(request);
  // A first like from this browser starts its identifier.
  const device = existing ?? crypto.randomUUID();
  const caller = await engagementCaller(request);
  const finish = async (response: NextResponse) => {
    if (!existing) issueViewerId(response, device);
    return caller.respond(response);
  };
  try {
    const result = await setFoundationPostLike(createFoundationServiceApi(), {
      postId: parsed.data.targetId,
      device,
      account: caller.account,
      liked: parsed.data.liked ?? null,
    });
    return finish(
      NextResponse.json({ liked: result.liked, likeCount: result.likes, counted: result.counted })
    );
  } catch (error) {
    if (error instanceof FoundationEngagementError) {
      if (error.reason === "unavailable")
        return finish(NextResponse.json({ error: "This post is not available" }, { status: 404 }));
      if (error.reason === "limit")
        return finish(
          NextResponse.json({ error: "Too many likes; try again later" }, { status: 429 })
        );
    }
    log.error("Failed to update like", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return finish(
      NextResponse.json({ error: "Unable to update like right now." }, { status: 503 })
    );
  }
}
