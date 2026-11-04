import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "./owner-route";
import { frontendClaimTypeSchema, readFrontendStaffClaims } from "./staff-claims";
import { nativeContentReviewSchema } from "../admin/native-content-review";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "./staff-command";
import { createLogger } from "../utils/logger";
const log = createLogger("NativeStaffQueue");
const item = {
  itemType: frontendClaimTypeSchema,
  itemId: z.uuid().transform((v) => v.toLowerCase()),
};
const schema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("claim"),
    queue: z.enum(["content", "reports", "kyc", "business_kyc"]),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  z.strictObject({ action: z.literal("renew") }),
  z
    .strictObject({
      action: z.literal("release"),
      itemType: item.itemType.optional(),
      itemId: item.itemId.optional(),
    })
    .refine((v) => Boolean(v.itemType) === Boolean(v.itemId)),
  z.strictObject({
    action: z.literal("reassign"),
    ...item,
    to: z.uuid().nullable(),
    reason: z.string().trim().min(5).max(500),
  }),
]);
const lease = {
  claim_generation: nativeContentReviewSchema.shape.claimGeneration,
  claim_nonce: z.uuid(),
  claim_expires_at: z.iso.datetime({ offset: true }),
};
const claimed = z.union([
  z.object({
    ...lease,
    subject: z.enum(["post", "report"]),
    id: z.uuid(),
    renewals_left: z.number().int().min(0).max(4),
    revision: z.number().int().positive().nullable(),
    edit_of: z.uuid().nullable(),
  }),
  z.object({ ...lease, case_id: z.uuid(), version: z.number().int().positive() }),
]);
export function handleRestoredQueueAction(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:queue",
    mutate: true,
    refusal: staffCommandRefusal,
    unavailableMessage:
      "The queue action could not be confirmed. Reload the queue before trying again.",
    signInMessage: "Sign in to manage the queue",
    command: async (api, input) => {
      const value = schema.parse(input);
      if (value.action === "claim") {
        const result = await settleStaffCommand(
          api.rpc(
            "claim_frontend_staff_items",
            { p_queue: value.queue, p_limit: value.limit },
            { get: false }
          ),
          z.strictObject({
            items: z.array(claimed).max(25),
            lease_minutes: z.union([z.literal(15), z.literal(30)]),
          })
        );
        const expectedMinutes = value.queue === "content" || value.queue === "reports" ? 15 : 30;
        if (
          result.lease_minutes !== expectedMinutes ||
          result.items.length > value.limit ||
          result.items.some((i) =>
            value.queue === "content"
              ? !("subject" in i) || i.subject !== "post"
              : value.queue === "reports"
                ? !("subject" in i) || i.subject !== "report"
                : !("case_id" in i)
          )
        )
          throw new FoundationStaffCommandError(503, "Reload the queue to confirm your claims.");
        return {
          claimed: result.items.length,
          items: result.items,
          message: result.items.length
            ? `You have ${result.items.length} new ${result.items.length === 1 ? "item" : "items"} for ${result.lease_minutes} minutes.`
            : "No independent waiting items are available to claim. Reload the queue to check your current items.",
        };
      }
      if (value.action === "renew" || (value.action === "release" && !value.itemId)) {
        const result = await settleStaffCommand(
          api.rpc("control_my_frontend_staff_claims", { p_action: value.action }, { get: false }),
          z.union([
            z.strictObject({ renewed: z.number().int().nonnegative() }),
            z.strictObject({ released: z.number().int().nonnegative() }),
          ])
        );
        if (value.action === "renew" ? !("renewed" in result) : !("released" in result))
          throw new FoundationStaffCommandError(503, "Reload the queue to confirm your claims.");
        return result;
      }
      // This lookup supplies no authority: commands recheck the current actor,
      // subject and exact lease. It prevents type aliases targeting another kind.
      const requested = value as Extract<
        z.infer<typeof schema>,
        { action: "release" | "reassign" }
      >;
      const type = requested.itemType!,
        id = requested.itemId!;
      const facts = await readFrontendStaffClaims(api, [{ type, id }]);
      const current = facts.items.find((c) => c.id === id && c.item_type === type);
      if (!current || (value.action === "release" && !current.mine))
        throw new FoundationStaffCommandError(409, "This claim changed. Reload the queue.");
      if (value.action === "release") {
        if (current.subject === "case")
          await settleStaffCommand(
            api.rpc(
              "release_evidence_claim",
              {
                p_case: id,
                p_claim_generation: current.generation!,
                p_claim_nonce: current.nonce!,
              },
              { get: false }
            ),
            z.literal(true)
          );
        else
          await settleStaffCommand(
            api.rpc(
              "release_queue_claim",
              {
                p_subject: current.subject,
                p_id: id,
                p_claim_generation: current.generation!,
                p_claim_nonce: current.nonce!,
              },
              { get: false }
            ),
            z.object({ id: z.literal(id), status: z.literal("released") })
          );
        return { released: 1 };
      }
      const expected = value.to === null ? "released" : "reassigned";
      const result = api.rpc(
        "reassign_frontend_staff_claim",
        { p_type: type, p_id: id, p_to: value.to, p_reason: value.reason },
        { get: false }
      );
      return settleStaffCommand(
        result,
        z.object({ id: z.literal(id), status: z.literal(expected) })
      );
    },
  });
}
