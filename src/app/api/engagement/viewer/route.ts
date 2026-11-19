import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { viewerSigningReady } from "@/lib/engagement-cookie";
import {
  isCountableRequest,
  readViewerId,
  setNewViewerId,
  viewerIssuingLimit,
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

/**
 * POST /api/engagement/viewer
 *
 * Issues the signed browser identifier (`vmz_viewer`) that views and
 * signed-out likes need, only after a valid Turnstile token (the site's own
 * widget, verified with Cloudflare here; TURNSTILE_SECRET_KEY) and within the
 * per-address issuing limit (`engagement:viewer:v4` per IPv4 address,
 * `engagement:viewer:v6` per IPv6 /48). A script therefore cannot mint
 * identifiers in bulk. When the check cannot be made, nothing is issued (fail
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

  const limit = await checkRateLimit({ ...viewerIssuingLimit(request), degradedMode: "block" });
  if (limit.limited)
    return NextResponse.json(
      { error: "Too many new visitors from this network; try again later" },
      {
        status: limit.degraded ? 503 : 429,
        headers: { ...headers, "Retry-After": String(limit.retryAfter ?? 60) },
      }
    );
  const captcha = await verifyPublicTurnstile(request, parsed.data.turnstile_token, log);
  if (captcha) return captcha;
  const response = NextResponse.json({ ok: true }, { headers });
  if (!(await setNewViewerId(response)))
    return NextResponse.json({ error: "Not available right now" }, { status: 503, headers });
  return response;
}
