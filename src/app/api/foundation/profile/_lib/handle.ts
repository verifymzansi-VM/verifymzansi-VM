import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import {
  FoundationProfileError,
  type FoundationAccountProfile,
} from "@/lib/foundation/account-profile";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";

const log = createLogger("FoundationProfile");
const noStore = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
};
const unavailable = () =>
  NextResponse.json(
    { error: "Your profile is temporarily unavailable" },
    { status: 503, headers: noStore }
  );
const refusals: Record<FoundationProfileError["reason"], [number, string]> = {
  invalid: [400, "Check the highlighted details and try again"],
  reserved: [400, "Choose a name that isn't a VerifyMzansi role or team name"],
  locked: [409, "Your verified name can't be changed"],
  changed: [409, "Your profile changed; reload it before saving"],
  legal_name_required: [409, "Add your legal name before verifying your identity"],
  avatar_unavailable: [400, "Upload the picture again"],
  unavailable: [503, "Your profile is temporarily unavailable"],
};

type Command = (
  api: FoundationAuthenticatedApi,
  input: unknown
) => Promise<FoundationAccountProfile>;

/** Foundation profile route: explicit foundation project, verified session,
 * per-client rate limit, origin and CSRF checks for writes, bounded JSON, and
 * one command per request with no automatic retry. */
export async function handleFoundationProfile(
  request: NextRequest,
  action: "profile:read" | "profile:update" | "profile:avatar",
  command: Command,
  mutate: boolean
) {
  if (mutate) {
    const origin = enforceSameOriginMutation(request, log);
    if (origin) return origin;
    const csrf = enforceCsrfToken(request, log);
    if (csrf) return csrf;
  }
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return unavailable();
  }
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action,
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          {
            error: limit.degraded
              ? "Profile protection is temporarily unavailable"
              : "Too many requests; try again shortly",
          },
          {
            status: limit.degraded ? 503 : 429,
            headers: { "Retry-After": String(limit.retryAfter ?? 60) },
          }
        )
      );
    let api: FoundationAuthenticatedApi;
    try {
      api = await context.authenticate();
    } catch (error) {
      if (!(error instanceof FoundationSessionError) || error.status === 503)
        return context.respond(unavailable());
      return context.respond(
        NextResponse.json({ error: "Sign in to manage your profile" }, { status: 401 })
      );
    }
    let input: unknown = null;
    if (mutate) {
      input = await parseJsonRequest(request, { maxBytes: 4096 });
      if (input === null)
        return context.respond(NextResponse.json({ error: refusals.invalid[1] }, { status: 400 }));
    }
    return context.respond(NextResponse.json(await command(api, input)));
  } catch (error) {
    if (error instanceof FoundationProfileError) {
      const [status, message] = refusals[error.reason];
      return context.respond(
        NextResponse.json({ error: message, reason: error.reason }, { status })
      );
    }
    log.error("Foundation profile request failed");
    return context.respond(unavailable());
  }
}
