import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "@/lib/foundation/owner-route";
import { createLogger } from "../utils/logger";
const log = createLogger("OwnerPostActions");
const common = {
  operationId: z.uuid(),
  expectedRevision: z.number().int().min(1).max(2147483644),
  contentType: z.enum(["listing", "business", "promotion"]),
  area: z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"]),
};
const standard = z.strictObject({ ...common, itemId: z.uuid() });
const lifecycle = z.strictObject({
  ...common,
  id: z.uuid(),
  action: z.enum(["deactivate", "mark_sold", "reactivate"]),
});
class ActionRefusal extends Error {
  constructor(readonly refusal: FoundationRefusal) {
    super(refusal.error);
  }
}
export function handleRestoredPostAction(
  request: NextRequest,
  mode: "delete" | "resubmit" | "lifecycle"
) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:update",
    mutate: true,
    unavailableMessage: "The action could not be confirmed. Reload your posts before trying again.",
    signInMessage: "Sign in to manage your posts",
    refusal: (error) =>
      error instanceof ActionRefusal
        ? error.refusal
        : error instanceof z.ZodError
          ? {
              status: 422,
              error: "Reload your posts before continuing",
              reason: "invalid_post_action",
            }
          : null,
    command: async (api, input) => {
      const value = mode === "lifecycle" ? lifecycle.parse(input) : standard.parse(input);
      const id = "id" in value ? value.id : value.itemId,
        action = "action" in value ? value.action : mode;
      const area =
        value.area === "MZANSI_MARKET"
          ? "market"
          : value.area === "MZANSI_BUSINESS"
            ? "business"
            : "tourism_events";
      const result = await api.rpc(
        "execute_my_frontend_post_action",
        {
          p_request: value.operationId,
          p_post: id.toLowerCase(),
          p_expected_revision: value.expectedRevision,
          p_action: action,
          p_kind: value.contentType === "promotion" ? "event" : value.contentType,
          p_area: area,
        },
        { get: false }
      );
      if (result.error) {
        const code = result.error.code;
        if (code === "42501")
          throw new ActionRefusal({
            status: 403,
            error: "Post access is unavailable",
            reason: "post_access_unavailable",
          });
        if (code === "PT402")
          throw new ActionRefusal({
            status: 403,
            error: "An active posting plan is required",
            reason: "posting_plan_required",
            upgradeUrl: `/pricing?area=${value.area}`,
          });
        if (code === "PT409")
          throw new ActionRefusal({
            status: 409,
            error:
              result.error.details === "posting_terms_required"
                ? "Review and accept the current posting terms before continuing"
                : "Your post or posting allowance changed. Reload your posts before continuing.",
            reason: "post_changed",
          });
        if (code === "PT429")
          throw new ActionRefusal({
            status: 429,
            error: "Your posting allowance has been reached",
            reason: "posting_limit",
          });
        if (code === "22023")
          throw new ActionRefusal({
            status: 422,
            error: "This action is unavailable for the current post. Check its dates and details.",
            reason: "invalid_post_action",
          });
        throw new Error("Owner action unavailable");
      }
      const ack = z
        .object({
          id: z.uuid(),
          status: z.enum(["deleted", "paused", "sold", "pending_moderation", "live"]),
          success: z.literal(true),
          revision: z.number().int().positive().optional(),
        })
        .parse(result.data);
      if (ack.id !== id.toLowerCase()) throw new Error("Post action changed");
      return ack;
    },
  });
}
