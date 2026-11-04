import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { governanceScopeSchema } from "./governance";
import { handleFoundationOwnerRoute } from "./owner-route";
import {
  settleStaffCommand,
  staffCommandRefusal,
  FoundationStaffCommandError,
} from "./staff-command";
import { createLogger } from "../utils/logger";
const log = createLogger("NativeGovernanceDecision");
const inputSchema = z
  .strictObject({
    action: z.enum(["approve", "reject", "escalate"]),
    decisionId: z.uuid(),
    rationale: z.string().trim().min(1).max(2000),
    payloadVersion: z.number().int().positive().optional(),
    foundation: governanceScopeSchema,
  })
  .refine((v) => v.action !== "approve" || v.payloadVersion === v.foundation.caseVersion);
export function handleRestoredGovernanceDecision(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:governance:decide",
    mutate: true,
    refusal: staffCommandRefusal,
    signInMessage: "Sign in to review governance decisions",
    unavailableMessage: "The decision could not be confirmed. Reload it before continuing.",
    command: async (api, body) => {
      const value = inputSchema.parse(body);
      const response = await settleStaffCommand(
        api.rpc(
          "decide_frontend_governance",
          {
            p_decision: value.decisionId,
            p_case: value.foundation.caseId,
            p_expected_version: value.foundation.caseVersion,
            p_proposal_version: value.foundation.proposalVersion,
            p_action: value.action,
            p_reason: value.rationale,
          },
          { get: false }
        ),
        z.object({
          decision_id: z.literal(value.decisionId),
          status: z.enum(["approved", "rejected", "withdrawn", "escalated"]),
          reused: z.boolean().optional(),
        })
      );
      if (
        (value.action === "approve" && response.status !== "approved") ||
        (value.action === "reject" && !["rejected", "withdrawn"].includes(response.status)) ||
        (value.action === "escalate" && response.status !== "escalated")
      )
        throw new FoundationStaffCommandError(
          503,
          "The decision outcome could not be confirmed. Reload the page."
        );
      return { status: response.status, decisionId: value.decisionId };
    },
  });
}
