import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "./owner-route";
import { nativeContentReviewSchema } from "../admin/native-content-review";
import { createLogger } from "../utils/logger";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "./staff-command";
import { foundationArea, foundationKind, restoredAreaSchema } from "./areas";
const log = createLogger("NativeModeration");
const shared = {
  ...nativeContentReviewSchema.shape,
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
};
const original = z.strictObject({
  ...shared,
  itemId: z.uuid(),
  area: restoredAreaSchema,
  contentType: z.enum(["listing", "business", "promotion"]),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).optional(),
});
const edit = z.strictObject({ ...shared, requestId: z.uuid() });
export function handleRestoredModerationDecision(request: NextRequest, isEdit: boolean) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:content:decide",
    mutate: true,
    unavailableMessage:
      "The decision could not be confirmed. Reload the queue before trying again.",
    signInMessage: "Sign in to review content",
    refusal: staffCommandRefusal,
    command: async (api, input) => {
      const value = isEdit ? edit.parse(input) : original.parse(input);
      if (value.decision === "reject" && (!value.reason || value.reason.length < 5))
        throw new FoundationStaffCommandError(
          422,
          "Give a rejection reason of at least 5 characters."
        );
      const id = ("requestId" in value ? value.requestId : value.itemId).toLowerCase();
      const context = await settleStaffCommand(
        api.rpc(
          "staff_review_post",
          {
            p_post_id: id,
            p_claim_generation: value.claimGeneration,
            p_claim_nonce: value.claimNonce,
          },
          { get: false }
        ),
        z.object({
          id: z.uuid(),
          kind: z.enum(["listing", "business", "event"]),
          area: z.enum(["market", "business", "tourism_events"]),
          revision: z.number().int().positive(),
          edit_of: z.uuid().nullable(),
        })
      );
      if (
        context.id !== id ||
        context.revision !== value.expectedRevision ||
        Boolean(context.edit_of) !== isEdit ||
        ("area" in value &&
          (context.area !== foundationArea(value.area) ||
            context.kind !== foundationKind(value.contentType)))
      )
        throw new FoundationStaffCommandError(409, "The reviewed item changed. Reload the queue.");
      const result = await settleStaffCommand(
        api.rpc(
          "moderate_post",
          {
            p_post_id: id,
            p_expected_revision: value.expectedRevision,
            p_decision: value.decision,
            ...(value.reason ? { p_reason: value.reason } : {}),
            p_claim_generation: value.claimGeneration,
            p_claim_nonce: value.claimNonce,
          },
          { get: false }
        ),
        z.object({
          id: z.uuid(),
          status: z.enum(["live", "rejected", "merged"]),
          edit_of: z.uuid().optional(),
          post_revision: z.number().int().positive().nullable().optional(),
          visible_until: z.iso.datetime({ offset: true }).nullable().optional(),
          price_only: z.boolean().optional(),
        })
      );
      const expectedStatus = value.decision === "reject" ? "rejected" : isEdit ? "merged" : "live";
      if (
        result.id !== id ||
        result.status !== expectedStatus ||
        (isEdit ? result.edit_of !== context.edit_of : result.edit_of !== undefined)
      )
        throw new FoundationStaffCommandError(503, "Reload the queue to confirm the decision.");
      return { success: true, ...result };
    },
  });
}
