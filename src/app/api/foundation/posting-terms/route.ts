import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import {
  acceptFoundationPostingTerms,
  readFoundationOwnerPostingTerms,
} from "@/lib/foundation/posting-terms";
import { assertPublishedPostingTerms } from "@/lib/legal/published-posting-terms";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { createLogger } from "@/lib/utils/logger";
import { parseJsonRequest } from "@/lib/utils/api";
import { checkRateLimit, getClientRateLimitIdentity } from "@/lib/utils/rate-limit";

const log = createLogger("PostingTerms");
function unavailable() {
  return NextResponse.json(
    { error: "Posting terms are temporarily unavailable" },
    {
      status: 503,
      headers: {
        "Cache-Control": "private, no-store",
        "CDN-Cache-Control": "no-store",
        "Cloudflare-CDN-Cache-Control": "no-store",
      },
    }
  );
}
async function handle(request: NextRequest, mutate: boolean) {
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return unavailable();
  }
  try {
    const limit = await checkRateLimit({
      key: getClientRateLimitIdentity(request).key,
      action: "account:posting-terms",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          {
            error: limit.degraded
              ? "Posting terms protection is temporarily unavailable"
              : "Too many requests; try again shortly",
          },
          {
            status: limit.degraded ? 503 : 429,
            headers: { "Retry-After": String(limit.retryAfter ?? 60) },
          }
        )
      );
    let api: Awaited<ReturnType<typeof context.authenticate>>;
    try {
      api = await context.authenticate();
    } catch (error) {
      if (!(error instanceof FoundationSessionError) || error.status === 503)
        return context.respond(unavailable());
      return context.respond(
        NextResponse.json({ error: "Sign in to review posting terms" }, { status: 401 })
      );
    }
    const document = await readFoundationOwnerPostingTerms(api);
    if (!document) return context.respond(unavailable());
    assertPublishedPostingTerms(document);
    if (!mutate) return context.respond(NextResponse.json(document));
    const input = await parseJsonRequest(request, { maxBytes: 4096 });
    if (input === null) {
      return context.respond(
        NextResponse.json({ error: "Invalid posting terms acceptance" }, { status: 400 })
      );
    }
    // The adapter validates all fields before its only write. A policy change
    // between this read and acceptance is fenced by the database transaction.
    const accepted = await acceptFoundationPostingTerms(api, input);
    assertPublishedPostingTerms(accepted);
    return context.respond(NextResponse.json(accepted));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Explicit acceptance of the displayed posting terms is required"
    )
      return context.respond(NextResponse.json({ error: error.message }, { status: 400 }));
    if (
      error instanceof Error &&
      error.message === "Posting terms changed; review the current version"
    )
      return context.respond(NextResponse.json({ error: error.message }, { status: 409 }));
    return context.respond(unavailable());
  }
}
export function GET(request: NextRequest) {
  return handle(request, false);
}
export async function POST(request: NextRequest) {
  const origin = enforceSameOriginMutation(request, log);
  if (origin) return origin;
  const csrf = enforceCsrfToken(request, log);
  if (csrf) return csrf;
  return handle(request, true);
}
