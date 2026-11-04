import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "./owner-route";
import { nativeContentReviewSchema } from "../admin/native-content-review";
import { adminFlaggingActionSchema } from "../validations/admin";
import {
  settleStaffCommand,
  staffCommandRefusal,
  FoundationStaffCommandError,
} from "./staff-command";
import { createLogger } from "../utils/logger";
const log = createLogger("NativeReportAction");
const inputSchema = adminFlaggingActionSchema
  .safeExtend({ foundation: nativeContentReviewSchema })
  .strict();
export function handleRestoredReportAction(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:flagging:action",
    mutate: true,
    refusal: staffCommandRefusal,
    signInMessage: "Sign in to review reports",
    unavailableMessage: "The action could not be confirmed. Reload reports before continuing.",
    command: async (api, body) => {
      const input = inputSchema.parse(body),
        scope = input.foundation;
      if (!input.reason || input.reason.length < 5)
        throw new FoundationStaffCommandError(
          422,
          "Give a review reason of at least 5 characters."
        );
      const result = await settleStaffCommand(
        api.rpc(
          "execute_frontend_report_action",
          {
            p_report: input.reportId,
            p_expected_revision: scope.expectedRevision,
            p_claim_generation: scope.claimGeneration,
            p_claim_nonce: scope.claimNonce,
            p_action: input.action,
            p_reason: input.reason,
            p_emergency: input.emergency ?? false,
            ...(input.durationDays ? { p_duration_days: input.durationDays } : {}),
          },
          { get: false }
        ),
        z.object({
          report_id: z.literal(input.reportId),
          action: z.literal(input.action),
          status: z.enum(["dismissed", "applied", "proposed", "emergency_applied"]),
          reused: z.boolean().optional(),
        })
      );
      if (input.action === "dismiss" && result.status !== "dismissed")
        throw new FoundationStaffCommandError(
          503,
          "The dismissal could not be confirmed. Reload reports."
        );
      const messages = {
        dismissed: "Report dismissed.",
        applied: "Action applied.",
        proposed: "Sent for approval. Someone else must approve it before it takes effect.",
        emergency_applied:
          "Emergency suspension applied for 72 hours. Someone else must approve the full action before then.",
      };
      return {
        success: true,
        action: input.action,
        status: result.status,
        decisionId: null,
        reviewDecisionId: null,
        message: messages[result.status],
      };
    },
  });
}
