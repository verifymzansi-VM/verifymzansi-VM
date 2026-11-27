import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "@/lib/foundation/owner-route";
import { createLogger } from "../utils/logger";
import { hasDatabaseReason } from "./error-reasons";
import { videoLengthRefusalMessage } from "./video-length-refusal";
import { foundationArea, foundationKind, restoredAreaSchema } from "./areas";
const log = createLogger("OwnerPostActions");
const common = {
  operationId: z.uuid(),
  expectedRevision: z.number().int().min(1).max(2147483644),
  contentType: z.enum(["listing", "business", "promotion"]),
  area: restoredAreaSchema,
};
const standard = z.strictObject({ ...common, itemId: z.uuid() });
const lifecycle = z.strictObject({
  ...common,
  id: z.uuid(),
  action: z.enum(["deactivate", "mark_sold", "reactivate"]),
});
/** Every owner action on a post hidden by staff (delete, resubmit, deactivate,
 * mark sold, reactivate) is refused until an independent release. */
const STAFF_HOLD_MESSAGE =
  "This post is hidden while our team reviews it. You can't republish, sell or delete it until the review is finished.";
/** Deleting is refused while a report from the public on the post is open,
 * as long as the scheduled clean-up waits for it (20261125150215, narrowed by
 * 20261125225855); hiding it still works. */
const REPORTED_POST_MESSAGE =
  "Someone reported this post. You can hide it now, and delete it once our team has looked at the report.";
class ActionRefusal extends Error {
  override name = "ActionRefusal";
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
      const area = foundationArea(value.area);
      const result = await api.rpc(
        "execute_my_frontend_post_action",
        {
          p_request: value.operationId,
          p_post: id.toLowerCase(),
          p_expected_revision: value.expectedRevision,
          p_action: action,
          p_kind: foundationKind(value.contentType),
          p_area: area,
        },
        { get: false }
      );
      if (result.error) {
        const code = result.error.code;
        if (code === "PT423")
          throw new ActionRefusal({
            status: 409,
            error: STAFF_HOLD_MESSAGE,
            reason: "staff_visibility_hold",
          });
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
        if (code === "PT409" && hasDatabaseReason(result.error, "post_report_open"))
          throw new ActionRefusal({
            status: 409,
            error: REPORTED_POST_MESSAGE,
            reason: "post_report_open",
          });
        // The member accepts the current terms on the post's Edit page (the
        // dashboard links there on this reason).
        if (code === "PT409" && hasDatabaseReason(result.error, "posting_terms_required"))
          throw new ActionRefusal({
            status: 409,
            error: "Review and accept the current posting terms before continuing",
            reason: "posting_terms_required",
          });
        if (code === "PT409")
          throw new ActionRefusal({
            status: 409,
            error: "Your post or posting allowance changed. Reload your posts before continuing.",
            reason: "post_changed",
          });
        if (code === "PT429")
          throw new ActionRefusal({
            status: 429,
            error: "Your posting allowance has been reached",
            reason: "posting_limit",
          });
        const videoLength = videoLengthRefusalMessage(result.error);
        if (videoLength)
          throw new ActionRefusal({ status: 422, error: videoLength, reason: "video_length" });
        if (code === "22023" && hasDatabaseReason(result.error, "copy_new_photo_required"))
          throw new ActionRefusal({
            status: 422,
            error: "Add at least one new photo of this item. Each car or home is a different item.",
            reason: "copy_new_photo_required",
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
