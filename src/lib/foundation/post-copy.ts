import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "./owner-route";
import { SHOW_POST_COPY } from "../hidden-features";
import { createLogger } from "../utils/logger";

const log = createLogger("PostCopy");

class CopyRefusal extends Error {
  override name = "CopyRefusal";
  constructor(readonly refusal: FoundationRefusal) {
    super(refusal.error);
  }
}

const copied = z.strictObject({
  id: z.uuid(),
  source_id: z.uuid(),
  status: z.literal("draft"),
  revision: z.number().int().positive(),
});

function refuse(code: string | undefined): never {
  if (code === "42501")
    throw new CopyRefusal({ status: 404, error: "Post not found", reason: "post_not_found" });
  if (code === "PT402")
    throw new CopyRefusal({
      status: 403,
      error: "Copy a post is part of the Multi-listing package.",
      reason: "package_required",
    });
  if (code === "PT423")
    throw new CopyRefusal({
      status: 409,
      error:
        "This post is hidden while our team reviews it. You can't copy it until the review is finished.",
      reason: "staff_visibility_hold",
    });
  if (code === "PT429")
    throw new CopyRefusal({
      status: 429,
      error: "You have too many unfinished drafts. Finish or delete one under Drafts first.",
      reason: "draft_limit",
    });
  if (code === "22023")
    throw new CopyRefusal({
      status: 422,
      error: "Only a Market listing that was submitted can be copied.",
      reason: "invalid_post_action",
    });
  if (code === "PT409")
    throw new CopyRefusal({
      status: 409,
      error: "Reload your posts before trying again.",
      reason: "post_changed",
    });
  throw new Error("Post copy unavailable");
}

/**
 * POST /api/listings/[id]/copy { operationId }: a new draft from one of the
 * caller's own Market listings (api.copy_my_post). Only while SHOW_POST_COPY
 * is on. A retry with the same operationId returns the same draft.
 */
export function handlePostCopy(request: NextRequest, id: string) {
  if (!SHOW_POST_COPY) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "listing_create",
    mutate: true,
    unavailableMessage: "The copy could not be confirmed. Reload your posts before trying again.",
    signInMessage: "Sign in to manage your posts",
    refusal: (error) =>
      error instanceof CopyRefusal
        ? error.refusal
        : error instanceof z.ZodError
          ? {
              status: 422,
              error: "Reload your posts before continuing",
              reason: "invalid_post_action",
            }
          : null,
    command: async (api, input) => {
      const { operationId } = z.strictObject({ operationId: z.uuid() }).parse(input);
      if (!z.uuid().safeParse(id).success) refuse("42501");
      const result = await api.rpc(
        "copy_my_post",
        { p_post: id.toLowerCase(), p_request: operationId.toLowerCase() },
        { get: false }
      );
      if (result.error) refuse(result.error.code);
      const copy = copied.parse(result.data);
      if (copy.source_id !== id.toLowerCase()) throw new Error("Post copy changed");
      return { id: copy.id, revision: copy.revision };
    },
  });
}
