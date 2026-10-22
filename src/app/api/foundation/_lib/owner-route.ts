import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import type { Logger } from "@/lib/utils/logger";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";

export const foundationNoStore = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
};

/** A known command refusal: HTTP status, user-facing message and stable reason. */
export type FoundationRefusal = { status: number; error: string; reason: string };

/** Owner route on the foundation project: same-origin and CSRF for writes,
 * per-client rate limit (blocking when the limiter is degraded), a
 * GoTrue-verified session, bounded JSON and exactly one command with no
 * automatic retry. Unknown failures become a generic 503. */
export async function handleFoundationOwnerRoute<T>({
  request,
  log,
  action,
  mutate,
  unavailableMessage,
  signInMessage,
  command,
  refusal,
}: {
  request: NextRequest;
  log: Logger;
  action: string;
  mutate: boolean;
  unavailableMessage: string;
  signInMessage: string;
  command: (api: FoundationAuthenticatedApi, input: unknown) => Promise<T>;
  refusal: (error: unknown) => FoundationRefusal | null;
}) {
  const unavailable = () =>
    NextResponse.json({ error: unavailableMessage }, { status: 503, headers: foundationNoStore });
  if (mutate) {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return blocked;
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
              ? "Protection is temporarily unavailable"
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
      return context.respond(NextResponse.json({ error: signInMessage }, { status: 401 }));
    }
    let input: unknown = null;
    if (mutate) {
      input = await parseJsonRequest(request, { maxBytes: 4096 });
      if (input === null)
        return context.respond(
          NextResponse.json({ error: "Check the details and try again" }, { status: 400 })
        );
    }
    return context.respond(NextResponse.json(await command(api, input)));
  } catch (error) {
    const known = refusal(error);
    if (known)
      return context.respond(
        NextResponse.json({ error: known.error, reason: known.reason }, { status: known.status })
      );
    log.error("Foundation owner request failed");
    return context.respond(unavailable());
  }
}
