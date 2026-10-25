import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { createFoundationServiceApi } from "@/lib/foundation/service-api";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import {
  readFoundationReviewContext,
  FoundationVerificationError,
} from "@/lib/foundation/verification-runtime";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { parseJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit } from "@/lib/utils/rate-limit";
const log = createLogger("FoundationVerificationReview");
const headers = { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store" };
const lease = {
  case_id: z.uuid(),
  claim_generation: z.string().regex(/^[1-9]\d{0,18}$/),
  claim_nonce: z.uuid(),
};
const input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("claim"), case_id: z.uuid() }),
  z.strictObject({ action: z.literal("context"), ...lease }),
  z.strictObject({ action: z.literal("release"), ...lease }),
  z.strictObject({
    action: z.literal("review"),
    ...lease,
    submission_id: z.uuid(),
    expected_version: z.number().int().positive(),
    number_matches: z.literal(true),
    selfie_matches: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("return"),
    ...lease,
    expected_version: z.number().int().positive(),
    reason: z.string().trim().min(5).max(500),
  }),
  z.strictObject({
    action: z.literal("approve"),
    decision_id: z.uuid(),
    ...lease,
    expected_version: z.number().int().positive(),
    number_matches: z.literal(true),
    selfie_matches: z.literal(true),
  }),
]);
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
      { error: "Review is temporarily unavailable" },
      { status: 503, headers }
    );
  }
  try {
    const caller = await context.authenticateCaller();
    const limit = await checkRateLimit({
      key: caller.accountId,
      action: mutate ? "admin:governance:decide" : "admin:evidence:metadata",
      degradedMode: "block",
    });
    if (limit.limited)
      return context.respond(
        NextResponse.json(
          { error: "Review protection unavailable or too many requests" },
          { status: limit.degraded ? 503 : 429, headers }
        )
      );
    if (!mutate) {
      const result = await caller.api.rpc("staff_verification_queue", { p_limit: 25 });
      if (result.error)
        throw new FoundationVerificationError(
          403,
          "A current reviewer session and authenticator code are required"
        );
      return context.respond(NextResponse.json(result.data, { headers }));
    }
    const value = input.parse(await parseJsonRequest(request, { maxBytes: 4096 }));
    if (value.action === "context")
      return context.respond(
        NextResponse.json(
          await readFoundationReviewContext(caller.api, createFoundationServiceApi(), {
            case_id: value.case_id,
            claim_generation: value.claim_generation,
            claim_nonce: value.claim_nonce,
          }),
          { headers }
        )
      );
    if (value.action === "approve") {
      const reviewed = await readFoundationReviewContext(caller.api, createFoundationServiceApi(), {
        case_id: value.case_id,
        claim_generation: value.claim_generation,
        claim_nonce: value.claim_nonce,
      });
      const pending = await caller.api.rpc("staff_verification_queue", { p_limit: 100 });
      const queue = z
        .array(z.object({ case_id: z.uuid(), decision_id: z.uuid().nullable() }))
        .parse(pending.data);
      if (
        pending.error ||
        reviewed.case_version !== value.expected_version ||
        !queue.some((row) => row.case_id === value.case_id && row.decision_id === value.decision_id)
      )
        throw new FoundationVerificationError(
          409,
          "The independent review changed. Reopen the case before approving."
        );
    }
    const result =
      value.action === "claim"
        ? await caller.api.rpc("claim_evidence_case", { p_case_id: value.case_id })
        : value.action === "release"
          ? await caller.api.rpc("release_evidence_claim", {
              p_case: value.case_id,
              p_claim_generation: value.claim_generation,
              p_claim_nonce: value.claim_nonce,
            })
          : value.action === "approve"
            ? await caller.api.rpc("approve_decision", { p_decision_id: value.decision_id })
            : value.action === "return"
              ? await caller.api.rpc("return_identity_submission", {
                  p_case: value.case_id,
                  p_expected_version: value.expected_version,
                  p_claim_generation: value.claim_generation,
                  p_claim_nonce: value.claim_nonce,
                  p_reason: value.reason,
                })
              : await caller.api.rpc("review_identity_submission", {
                  p_submission: value.submission_id,
                  p_expected_version: value.expected_version,
                  p_claim_generation: value.claim_generation,
                  p_claim_nonce: value.claim_nonce,
                  p_number_matches: value.number_matches,
                  p_selfie_matches: value.selfie_matches,
                });
    if (result.error)
      throw new FoundationVerificationError(
        result.error.code === "PT409" ? 409 : 403,
        "The case, claim or reviewer permission changed. Refresh the queue and complete two-step verification if required."
      );
    return context.respond(NextResponse.json(result.data, { headers }));
  } catch (error) {
    const status =
      error instanceof FoundationVerificationError || error instanceof FoundationSessionError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503;
    return context.respond(
      NextResponse.json(
        {
          error:
            error instanceof FoundationVerificationError
              ? error.message
              : status === 401
                ? "Sign in to review verification"
                : "The verification queue could not be loaded",
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
