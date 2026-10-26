import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createFoundationPublicApi, type FoundationPublicApi } from "@/lib/foundation/public-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import { FoundationOrganisationError } from "@/lib/foundation/organisations";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";
import {
  foundationNoStore,
  handleFoundationOwnerRoute,
  type FoundationRefusal,
} from "./owner-route";

const log = createLogger("FoundationOrganisations");
const refusals: Record<FoundationOrganisationError["reason"], [number, string]> = {
  invalid: [400, "Check the details and try again"],
  not_found: [404, "Not found"],
  conflict: [409, "This has changed or is already done; reload and try again"],
  forbidden: [403, "You don't have access to this organisation"],
  verification_required: [403, "Complete identity verification first"],
  invite_invalid: [409, "This invitation link is no longer valid"],
  limited: [429, "Too many requests; try again later"],
  unavailable: [503, "Organisations are temporarily unavailable"],
};
function organisationRefusal(error: unknown): FoundationRefusal | null {
  if (!(error instanceof FoundationOrganisationError)) return null;
  const [status, message] = refusals[error.reason];
  return { status, error: message, reason: error.reason };
}

/** Signed-in organisation route; see handleFoundationOwnerRoute. */
export function handleOrganisationRoute<T>(
  request: NextRequest,
  action:
    | "organisation:read"
    | "organisation:apply"
    | "organisation:manage"
    | "organisation:invite"
    | "partner:attribution",
  mutate: boolean,
  command: (api: FoundationAuthenticatedApi, input: unknown) => Promise<T>,
  includeAccountId = false
) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action,
    mutate,
    unavailableMessage: "Organisations are temporarily unavailable",
    signInMessage: "Sign in to continue",
    command,
    refusal: organisationRefusal,
    includeAccountId,
  });
}

/** Public read: rate limited per client, no session, no cookies. */
export async function handlePublicOrganisationRead<T>(
  request: NextRequest,
  read: (api: FoundationPublicApi) => Promise<T>
) {
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "organisation:public",
      degradedMode: "block",
    });
    if (limit.limited)
      return NextResponse.json(
        { error: "Too many requests; try again shortly" },
        {
          status: limit.degraded ? 503 : 429,
          headers: { ...foundationNoStore, "Retry-After": String(limit.retryAfter ?? 60) },
        }
      );
    const result = await read(createFoundationPublicApi(readFoundationRuntimeConnection()));
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    const known = organisationRefusal(error);
    if (known && known.status !== 503)
      return NextResponse.json(
        { error: known.error, reason: known.reason },
        { status: known.status, headers: foundationNoStore }
      );
    log.error("Foundation organisation read failed");
    return NextResponse.json(
      { error: "Organisations are temporarily unavailable" },
      { status: 503, headers: foundationNoStore }
    );
  }
}
