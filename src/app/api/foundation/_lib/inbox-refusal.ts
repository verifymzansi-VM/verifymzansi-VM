import "server-only";

import { FoundationInboxError } from "@/lib/foundation/owner-inbox";
import type { FoundationRefusal } from "./owner-route";

const refusals: Record<FoundationInboxError["reason"], [number, string]> = {
  invalid: [400, "Check the details and try again"],
  post_unavailable: [404, "This post is no longer available"],
  enquiries_disabled: [
    403,
    "This poster isn't taking messages; use the contact options on the post",
  ],
  own_post: [400, "You can't send a message about your own post"],
  sender_inactive: [403, "Your account can't send messages right now"],
  limited: [429, "Too many messages; try again later"],
  conflict: [409, "This message was already sent with different details"],
  unavailable: [503, "Messages are temporarily unavailable"],
};

export function inboxRefusal(error: unknown): FoundationRefusal | null {
  if (!(error instanceof FoundationInboxError)) return null;
  const [status, message] = refusals[error.reason];
  return { status, error: message, reason: error.reason };
}

/** Owner page cursor from query parameters; absent values stay absent. */
export function inboxPageQuery(request: Request, statusAllowed: boolean) {
  const query = new URL(request.url).searchParams;
  const limit = query.get("limit");
  const status = query.get("status");
  const created = query.get("before_created");
  const id = query.get("before_id");
  return {
    ...(limit === null ? {} : { limit: Number(limit) }),
    ...(statusAllowed && status !== null ? { status } : {}),
    ...(created === null && id === null
      ? {}
      : { cursor: { before_created: created, before_id: id } }),
  };
}
