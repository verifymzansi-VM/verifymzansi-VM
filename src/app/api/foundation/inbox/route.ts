import type { NextRequest } from "next/server";
import { readFoundationInboxCounts } from "@/lib/foundation/owner-inbox";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "../_lib/owner-route";
import { inboxRefusal } from "../_lib/inbox-refusal";

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
