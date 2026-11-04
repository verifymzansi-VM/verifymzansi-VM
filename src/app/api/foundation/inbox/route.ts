import type { NextRequest } from "next/server";
import { readFoundationInboxCounts } from "@/lib/foundation/owner-inbox";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { inboxRefusal } from "@/lib/foundation/inbox-refusal";

const log = createLogger("FoundationInbox");

/** Unread message and notification counts for the signed-in owner's badges. */
export function GET(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:read",
    mutate: false,
    unavailableMessage: "Your inbox is temporarily unavailable",
    signInMessage: "Sign in to see your inbox",
    command: readFoundationInboxCounts,
    refusal: inboxRefusal,
  });
}
