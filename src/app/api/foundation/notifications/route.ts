import type { NextRequest } from "next/server";
import {
  markFoundationNotificationsRead,
  readFoundationNotifications,
} from "@/lib/foundation/owner-inbox";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute } from "../_lib/owner-route";
import { inboxPageQuery, inboxRefusal } from "../_lib/inbox-refusal";

const log = createLogger("FoundationNotifications");

/** Owner notifications page: GET /api/foundation/notifications?limit=&before_created=&before_id= */
export function GET(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:read",
    mutate: false,
    includeAccountId: true,
    unavailableMessage: "Notifications are temporarily unavailable",
    signInMessage: "Sign in to see your notifications",
    command: (api) => readFoundationNotifications(api, inboxPageQuery(request, false)),
    refusal: inboxRefusal,
  });
}

/** Mark read: { ids?: uuid[] } — omit ids to mark everything read. */
export function POST(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:update",
    mutate: true,
    unavailableMessage: "Notifications are temporarily unavailable",
    signInMessage: "Sign in to manage your notifications",
    command: markFoundationNotificationsRead,
    refusal: inboxRefusal,
  });
}
