import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CONTENT_TARGET_TYPES } from "@/lib/engagement";
import { viewerSigningReady } from "@/lib/engagement-cookie";
import {
  engagementCaller,
  engagementClientKey,
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
import { checkRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("EngagementLikeRoute");

const likeRequest = z.object({
  targetId: z.uuid(),
  targetType: z.enum(CONTENT_TARGET_TYPES),
  /** The state the visitor asked for; absent toggles (older pages). */
  liked: z.boolean().optional(),
});

const unavailable = () =>
  NextResponse.json({ error: "Unable to update like right now." }, { status: 503 });

/**
 * POST /api/engagement/like
 *
 * Anyone can like a publicly live post. Signed in, the like is the account's
 * (on any browser); signed out, it is the browser's, identified by the
 * `vmz_viewer` cookie this website signed (issued here when missing, within
 * the per-address issuing limit). The database stores the account, or only a
 * keyed hash of the browser identifier (api.set_post_like); the owner's and
 * staff's own likes are never stored. Origin and CSRF checks, crawlers and
 * headless browsers refused, a per-address limit (`engagement:like`) and a
 * per-post limit in the database. Without the signing secret no like is
 * stored (503). Answers { liked, likeCount, counted }.
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
  if (!viewerSigningReady()) {
    log.error("Like refused: ENGAGEMENT_COOKIE_SECRET is not set");
    return unavailable();
  }

  const limit = await checkRateLimit({
    key: engagementClientKey(request),
    action: "engagement:like",
    degradedMode: "local",
  });
  if (limit.limited)
    return NextResponse.json(
      { error: "Too many likes; try again later" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
    );

  // A first like from this browser starts its signed identifier.
  const cookieCarrier = NextResponse.json({});
  const device = (await readViewerId(request)) ?? (await issueViewerId(request, cookieCarrier));
  if (!device)
    return NextResponse.json(
      { error: "Too many likes from this network; try again later" },
      { status: 429 }
    );
  const caller = await engagementCaller(request);
  const finish = async (response: NextResponse) => {
    const issued = cookieCarrier.cookies.getAll();
    for (const cookie of issued) response.cookies.set(cookie);
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
    return finish(unavailable());
  }
}
