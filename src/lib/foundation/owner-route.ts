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
import { recordSecurityEvent, securityContext } from "@/lib/security/security-events";
import { logRequestFailure } from "@/lib/utils/request-failure";

export const foundationNoStore = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
};

/** A known command refusal: HTTP status, user-facing message and stable reason. */
export type FoundationRefusal = {
  status: number;
  error: string;
  reason: string;
  code?: string;
  issues?: Array<{ path: string; message: string }>;
  details?: Record<string, string>;
  redirectUrl?: string;
  upgradeUrl?: string;
};

/** Owner route on the foundation project: same-origin and CSRF for writes,
 * per-client rate limit (blocking when the limiter is degraded), a
 * GoTrue-verified session, bounded JSON and exactly one command with no
 * automatic retry. Unknown failures become a generic 503 carrying a request
 * reference; the matching log line names the error type, failed command and
 * database error code. */
export async function handleFoundationOwnerRoute<T>({
  request,
  log,
  action,
  mutate,
  unavailableMessage,
  signInMessage,
  command,
  refusal,
  includeAccountId = false,
  requireCaller = false,
  maxBytes = 4096,
  successStatus = 200,
  responseHeaders,
}: {
  request: NextRequest;
  log: Logger;
  action: string;
  mutate: boolean;
  unavailableMessage: string;
  signInMessage: string;
  command: (
    api: FoundationAuthenticatedApi,
    input: unknown,
    caller?: { accountId: string; sessionId: string }
  ) => Promise<T>;
  refusal: (error: unknown) => FoundationRefusal | null;
  includeAccountId?: boolean;
  requireCaller?: boolean;
  maxBytes?: number;
  successStatus?: 200 | 201;
  responseHeaders?: (data: T) => Record<string, string>;
}) {
  const unavailable = (reference: string) =>
    NextResponse.json(
      { error: unavailableMessage, reference },
      { status: 503, headers: foundationNoStore }
    );
  if (mutate) {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return blocked;
  }
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch (error) {
    return unavailable(
      logRequestFailure(log, "Foundation binding unavailable", { request, error, action })
    );
  }
  let api: FoundationAuthenticatedApi | undefined;
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action,
      degradedMode: "block",
    });
    if (limit.degraded || limit.limited)
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
    let caller: { accountId: string; sessionId: string } | undefined;
    try {
      if (includeAccountId || requireCaller) {
        const verified = await context.authenticateCaller();
        api = verified.api;
        caller = { accountId: verified.accountId, sessionId: verified.sessionId };
      } else api = await context.authenticate();
    } catch (error) {
      if (!(error instanceof FoundationSessionError) || error.status === 503)
        return context.respond(
          unavailable(
            logRequestFailure(log, "Foundation session check unavailable", {
              request,
              error,
              action,
            })
          )
        );
      return context.respond(NextResponse.json({ error: signInMessage }, { status: 401 }));
    }
    let input: unknown = null;
    if (mutate) {
      input = await parseJsonRequest(request, { maxBytes });
      if (input === null)
        return context.respond(
          NextResponse.json({ error: "Check the details and try again" }, { status: 400 })
        );
    }
    const data = await command(api, input, caller);
    return context.respond(
      NextResponse.json(includeAccountId ? { account_id: caller?.accountId, data } : data, {
        status: successStatus,
        headers: responseHeaders?.(data),
      })
    );
  } catch (error) {
    const known = refusal(error);
    if (known?.status === 403)
      recordSecurityEvent({
        event: "request.permission_denied",
        ...securityContext(request),
        reason: known.reason,
      });
    const logFailure = () =>
      logRequestFailure(log, "Foundation owner request failed", { request, error, api, action });
    if (!known) return context.respond(unavailable(logFailure()));
    // A refusal that means "unavailable" (5xx) is still a failure to explain.
    const reference = known.status >= 500 ? logFailure() : undefined;
    return context.respond(
      NextResponse.json(
        {
          error: known.error,
          reason: known.reason,
          ...(reference ? { reference } : {}),
          ...(known.code ? { code: known.code } : {}),
          ...(known.issues ? { issues: known.issues } : {}),
          ...(known.details ? { details: known.details } : {}),
          ...(known.redirectUrl ? { redirectUrl: known.redirectUrl } : {}),
          ...(known.upgradeUrl ? { upgradeUrl: known.upgradeUrl } : {}),
        },
        { status: known.status }
      )
    );
  }
}
