import { NextResponse, type NextRequest } from "next/server";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import {
  readFoundationVerificationStatus,
  submitFoundationIdentity,
  FoundationVerificationError,
} from "@/lib/foundation/verification-runtime";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { createLogger } from "@/lib/utils/logger";
import { readBoundedRequestFormData, RequestBodyTooLargeError } from "@/lib/utils/request-body";
import { checkRateLimit } from "@/lib/utils/rate-limit";
const log = createLogger("FoundationVerification");
const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" };
async function handle(request: NextRequest, mutate: boolean) {
  if (mutate) {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return blocked;
  }
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return NextResponse.json(
      { error: "Verification is temporarily unavailable" },
      { status: 503, headers }
    );
  }
  try {
    const caller = await context.authenticateCaller();
    const limit = await checkRateLimit({
      key: caller.accountId,
      action: mutate ? "verification:upload" : "verification:status",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          { error: "Verification protection unavailable or too many requests" },
          { status: limit.degraded ? 503 : 429, headers }
        )
      );
    if (!mutate)
      return context.respond(
        NextResponse.json(await readFoundationVerificationStatus(caller.api), { headers })
      );
    const form = await readBoundedRequestFormData(request, 12 * 1024 * 1024);
    const document = form.get("document"),
      selfie = form.get("selfie"),
      id = form.get("id_number");
    if (!(document instanceof File) || !(selfie instanceof File) || typeof id !== "string")
      return context.respond(
        NextResponse.json(
          { error: "Provide your ID number, ID document and selfie" },
          { status: 400, headers }
        )
      );
    return context.respond(
      NextResponse.json(
        await submitFoundationIdentity(
          caller.api,
          createFoundationServiceApi(),
          caller.accountId,
          id,
          document,
          selfie
        ),
        { headers }
      )
    );
  } catch (error) {
    const status =
      error instanceof FoundationSessionError || error instanceof FoundationVerificationError
        ? error.status
        : error instanceof RequestBodyTooLargeError
          ? 413
          : 503;
    return context.respond(
      NextResponse.json(
        {
          error:
            error instanceof FoundationVerificationError
              ? error.message
              : status === 401
                ? "Sign in to verify your account"
                : "Verification could not be completed",
        },
        { status, headers }
      )
    );
  }
}
export function GET(request: NextRequest) {
  return handle(request, false);
}
export function POST(request: NextRequest) {
  return handle(request, true);
}
