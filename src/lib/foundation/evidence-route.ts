import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import {
  readFoundationEvidenceBytes,
  FoundationVerificationError,
} from "@/lib/foundation/verification-runtime";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { nativeIdentityScopeSchema } from "@/lib/admin/native-identity-review";
import { evidenceViewResponse } from "@/lib/services/evidence-serving";
import { FoundationStaffCommandError, staffCommandRefusal } from "./staff-command";
const log = createLogger("FoundationEvidence");
const headers = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};
export async function handleFoundationEvidenceRead(
  request: NextRequest,
  mode: "native" | "restored" = "native"
) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  let context: ReturnType<typeof createFoundationRouteContext>;
  try {
    context = createFoundationRouteContext(readFoundationRuntimeConnection(), request);
  } catch {
    return NextResponse.json(
      { error: "Evidence is temporarily unavailable" },
      { status: 503, headers }
    );
  }
  try {
    const caller = await context.authenticateCaller();
    const limit = await checkRateLimit({
      key: caller.accountId,
      action: "admin:evidence:view",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          { error: "Evidence protection unavailable or too many requests" },
          { status: limit.degraded ? 503 : 429, headers }
        )
      );
    const body = await parseJsonRequest(request, { maxBytes: 4096 });
    const restored =
      mode === "restored"
        ? z
            .strictObject({ artifactId: z.uuid(), foundation: nativeIdentityScopeSchema })
            .parse(body)
        : null;
    const value = restored
      ? {
          case_id: restored.foundation.caseId,
          claim_generation: restored.foundation.claimGeneration,
          claim_nonce: restored.foundation.claimNonce,
          artifact_id: restored.artifactId,
          expected_case_version: restored.foundation.caseVersion,
          expected_submission_id: restored.foundation.submissionId,
        }
      : z
          .strictObject({
            case_id: z.uuid(),
            claim_generation: z.string().regex(/^[1-9]\d{0,18}$/),
            claim_nonce: z.uuid(),
            artifact_id: z.uuid(),
          })
          .parse(body);
    const evidence = await readFoundationEvidenceBytes(
      caller.api,
      createFoundationServiceApi(),
      {
        case_id: value.case_id,
        claim_generation: value.claim_generation,
        claim_nonce: value.claim_nonce,
        ...("expected_case_version" in value
          ? {
              expected_case_version: value.expected_case_version,
              expected_submission_id: value.expected_submission_id,
            }
          : {}),
      },
      value.artifact_id
    );
    const response = evidenceViewResponse(Buffer.from(evidence.bytes));
    response.headers.set("X-VerifyMzansi-Actor", caller.accountId);
    return context.respond(response);
  } catch (error) {
    const status =
      error instanceof FoundationVerificationError ||
      error instanceof FoundationSessionError ||
      error instanceof FoundationStaffCommandError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503;
    return context.respond(
      NextResponse.json(
        {
          error: "Evidence is unavailable, the claim expired or permission changed",
          ...(staffCommandRefusal(error)?.code ? { code: staffCommandRefusal(error)!.code } : {}),
        },
        { status, headers }
      )
    );
  }
}
