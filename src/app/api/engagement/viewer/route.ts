import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { VIEWER_CHALLENGE_ACTION } from "@/lib/engagement";
import { viewerSigningReady } from "@/lib/engagement-cookie";
import {
  engagementClientKey,
  isCountableRequest,
  readViewerId,
  setNewViewerId,
} from "@/lib/engagement-route";
import { SHOW_ENGAGEMENT_TOTALS } from "@/lib/hidden-features";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { verifyPublicTurnstile } from "@/lib/utils/public-mutation-route";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("EngagementViewerRoute");

const viewerRequest = z.strictObject({ turnstile_token: z.string().min(1).max(4096) });
const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" };
const tooMany = (retryAfter?: number) =>
  NextResponse.json(
    { error: "Too many new visitors from this network; try again later" },
    { status: 429, headers: { ...headers, "Retry-After": String(retryAfter ?? 60) } }
  );

/**
 * POST /api/engagement/viewer
 *
 * Issues the signed browser identifier (`vmz_viewer`) that views and
 * signed-out likes need, only after a valid Turnstile token from the site's
 * own widget for this purpose (action `engagement_viewer`, solved on this
 * site; verified with Cloudflare here, TURNSTILE_SECRET_KEY), and within the
 * issuing limit `engagement:viewer` per IPv4 address or IPv6 /48 (generous,
 * for carrier-grade NAT). The limit is only read before the check and is spent
 * only by a successful issue, so failed or forged checks never use up a
 * network's allowance. When the check cannot be made, nothing is issued (fail
 * closed); identifiers already issued keep working. A browser that already
 * holds a valid identifier keeps it.
 *
 * While SHOW_ENGAGEMENT_TOTALS is off the route answers 204 No Content without
 * reading the request.
 */
export async function POST(request: NextRequest) {
  if (!SHOW_ENGAGEMENT_TOTALS) return new NextResponse(null, { status: 204 });
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  if (!isCountableRequest(request))
    return NextResponse.json({ error: "Not available" }, { status: 403, headers });
  const parsed = viewerRequest.safeParse(await parseJsonRequest(request, { maxBytes: 8192 }));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Complete the check and try again" },
      { status: 400, headers }
    );
  if (!viewerSigningReady()) {
    log.error("Viewer identifier not issued: ENGAGEMENT_COOKIE_SECRET is not set");
    return NextResponse.json({ error: "Not available right now" }, { status: 503, headers });
  }
  if (await readViewerId(request)) return NextResponse.json({ ok: true }, { headers });

  const limit = { key: engagementClientKey(request), action: "engagement:viewer" } as const;
  // Read only: is there room for one more?
  const room = await checkRateLimit({ ...limit, readOnly: true, degradedMode: "block" });
  if (room.limited) return room.degraded ? unavailable() : tooMany(room.retryAfter);
  const captcha = await verifyPublicTurnstile(request, parsed.data.turnstile_token, log, {
    action: VIEWER_CHALLENGE_ACTION,
  });
  if (captcha) return captcha;
  // Spent only now, by a check that passed.
  const spent = await checkRateLimit({ ...limit, degradedMode: "block" });
  if (spent.limited) return spent.degraded ? unavailable() : tooMany(spent.retryAfter);
  const response = NextResponse.json({ ok: true }, { headers });
  if (!(await setNewViewerId(response))) return unavailable();
  return response;
}

function unavailable() {
  return NextResponse.json({ error: "Not available right now" }, { status: 503, headers });
}
