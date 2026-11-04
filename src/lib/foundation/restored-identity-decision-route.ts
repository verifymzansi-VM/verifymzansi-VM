import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "./owner-route";
import {
  settleStaffCommand,
  staffCommandRefusal,
  FoundationStaffCommandError,
} from "./staff-command";
import { nativeIdentityScopeSchema } from "../admin/native-identity-review";
import { adminVerificationDecideSchema } from "../validations/admin";
import { createLogger } from "../utils/logger";
const log = createLogger("NativeIdentityDecision");
const inputSchema = adminVerificationDecideSchema
  .safeExtend({ foundation: nativeIdentityScopeSchema, stepMatches: z.boolean().optional() })
  .strict();
export function handleRestoredIdentityDecision(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:verification:decide",
    mutate: true,
    refusal: staffCommandRefusal,
    signInMessage: "Sign in to review identity evidence",
    unavailableMessage:
      "The decision could not be confirmed. Reload the verification queue before trying again.",
    command: async (api, body) => {
      const input = inputSchema.parse(body),
        scope = input.foundation;
      const bound = {
        p_case: scope.caseId,
        p_submission: scope.submissionId,
        p_artifact: input.stepId,
        p_expected_version: scope.caseVersion,
        p_claim_generation: scope.claimGeneration,
        p_claim_nonce: scope.claimNonce,
      };
      if (input.decision === "approved") {
        if (input.stepMatches !== true)
          throw new FoundationStaffCommandError(
            422,
            "Confirm the displayed ID details or selfie portrait match before approving."
          );
        const result = await settleStaffCommand(
          api.rpc(
            "approve_frontend_identity_step",
            {
              ...bound,
              p_matches: input.stepMatches,
              ...(input.reasonNote ? { p_note: input.reasonNote } : {}),
              ...(input.overrideReasonCode ? { p_override_reason: input.overrideReasonCode } : {}),
            },
            { get: false }
          ),
          z
            .object({
              case_id: z.literal(scope.caseId),
              submission_id: z.literal(scope.submissionId),
              artifact_id: z.literal(input.stepId),
              purpose: z.enum(["id_front", "selfie"]),
              status: z.enum(["step_approved", "accepted", "awaiting_second_reviewer"]),
              decision_id: z.uuid().optional(),
              identity_fact_id: z.uuid().optional(),
              reused: z.boolean().optional(),
            })
            .refine((v) => v.status !== "accepted" || Boolean(v.identity_fact_id))
            .refine((v) => v.status !== "awaiting_second_reviewer" || Boolean(v.decision_id))
        );
        return {
          success: true,
          status: result.status,
          ...(result.decision_id ? { overrideProposed: true, decisionId: result.decision_id } : {}),
        };
      }
      const reason = `${input.decision === "rejected" ? "Rejected" : "Retake requested"} (${input.reasonCode}): ${input.reasonNote}`;
      if (reason.length > 500)
        throw new FoundationStaffCommandError(
          422,
          "Keep the explanation and reason code together under 500 characters."
        );
      const result = await settleStaffCommand(
        api.rpc(
          "return_frontend_identity_step",
          { ...bound, p_decision: input.decision, p_reason: reason },
          { get: false }
        ),
        z
          .object({
            case_id: z.literal(scope.caseId),
            submission_id: z.literal(scope.submissionId),
            artifact_id: z.literal(input.stepId),
            status: z.literal("needs_resubmission"),
            decision: z.literal(input.decision),
            version: z.number().int().positive(),
          })
          .refine((v) => v.version > scope.caseVersion)
      );
      return { success: true, status: result.decision, version: result.version };
    },
  });
}
