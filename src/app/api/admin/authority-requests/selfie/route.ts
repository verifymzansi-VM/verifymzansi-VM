import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import {
  authorityRequestRefusal,
  readIdentityDisclosureSelfie,
} from "@/lib/foundation/identity-disclosures";
import { foundationNoStore } from "@/lib/foundation/owner-route";
import { evidenceViewResponse } from "@/lib/services/evidence-serving";
import { limitStaffEvidenceView } from "@/lib/foundation/evidence-route";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { logRequestFailure } from "@/lib/utils/request-failure";

const log = createLogger("AuthorityRequestSelfie");
const headers = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};
const body = z.strictObject({ disclosureId: z.uuid(), subject: z.uuid() });

/**
 * GET /api/admin/authority-requests/selfie
 * Refused: identifiers in a query string leak into logs and browser history.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Use the protected selfie POST request" },
    { status: 405, headers: foundationNoStore }
  );
}

/**
 * POST /api/admin/authority-requests/selfie
 *
 * The selfie of one person an open authority request names, decrypted for the
 * opener's screen. The database logs the look first and checks the caller
 * opened the record less than 15 minutes ago, with
 * an authenticator code from the last 15 minutes. Never cached.
 */
export async function POST(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return NextResponse.json({ error: "The selfie is unavailable" }, { status: 503, headers });
  }
  try {
    const caller = await context.authenticateCaller();
    const limited = await limitStaffEvidenceView(caller.accountId);
    if (limited) return context.respond(limited);
    const input = body.parse(await parseJsonRequest(request, { maxBytes: 1024 }));
    const bytes = await readIdentityDisclosureSelfie(
      caller.api,
      createFoundationServiceApi(),
      caller.accountId,
      input.disclosureId,
      input.subject
    );
    if (!bytes)
      return context.respond(
        NextResponse.json({ error: "No selfie is kept for this person" }, { status: 404, headers })
      );
    const response = evidenceViewResponse(Buffer.from(bytes));
    response.headers.set("X-VerifyMzansi-Actor", caller.accountId);
    return context.respond(response);
  } catch (error) {
    if (error instanceof FoundationSessionError && error.status !== 503)
      return context.respond(
        NextResponse.json({ error: "Sign in again" }, { status: error.status, headers })
      );
    const known = authorityRequestRefusal(error);
    if (!known) {
      const reference = logRequestFailure(log, "Authority request selfie failed", {
        request,
        error,
        action: "admin:authority-requests:selfie",
      });
      return context.respond(
        NextResponse.json(
          { error: "The selfie is unavailable", reference },
          { status: 503, headers }
        )
      );
    }
    return context.respond(
      NextResponse.json(
        {
          error: known.error,
          reason: known.reason,
          ...(known.code ? { code: known.code } : {}),
          ...(known.redirectUrl ? { redirectUrl: known.redirectUrl } : {}),
        },
        { status: known.status, headers }
      )
    );
  }
}
