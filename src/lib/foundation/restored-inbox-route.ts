import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import {
  readFoundationPresentedEnquiries,
  readFoundationInboxCounts,
  setFoundationEnquiryStatus,
  FoundationInboxError,
} from "./owner-inbox";
import { restoredEnquiry } from "./restored-inbox";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { inboxRefusal } from "@/lib/foundation/inbox-refusal";
import { createBooleanFlagSchema, createBoundedIntegerSchema } from "../validations/shared";
import { createLogger } from "../utils/logger";
const log = createLogger("RestoredInbox");
const querySchema = z.object({
  unread: createBooleanFlagSchema(false),
  countOnly: createBooleanFlagSchema(false),
  limit: createBoundedIntegerSchema({ defaultValue: 25, min: 1, max: 50, fieldName: "limit" }),
});
class MissingEnquiry extends Error {}
export function handleRestoredInbox(request: NextRequest, mutate: boolean) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: mutate ? "inbox:update" : "inbox:read",
    mutate,
    unavailableMessage: "Your enquiries are temporarily unavailable",
    signInMessage: "Sign in to see your enquiries",
    command: async (api, input) => {
      if (mutate) {
        const result = await setFoundationEnquiryStatus(api, input);
        if (!result) throw new MissingEnquiry();
        return { success: true, lead: { id: result.id, status: result.status } };
      }
      const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
      if (!query.success) throw new FoundationInboxError("invalid");
      const account = await readFoundationAccountContext(api);
      if (query.data.countOnly) {
        const counts = await readFoundationInboxCounts(api);
        return { accountId: account.account_id, unreadCount: counts.unread_enquiries, leads: [] };
      }
      const page = await readFoundationPresentedEnquiries(api, {
        limit: query.data.limit,
        ...(query.data.unread ? { status: "new" } : {}),
      });
      return {
        accountId: account.account_id,
        unreadCount: page.unread_count,
        leads: page.items.map(restoredEnquiry),
      };
    },
    refusal: (error) =>
      error instanceof MissingEnquiry
        ? { status: 404, error: "Enquiry not found", reason: "enquiry_not_found" }
        : error instanceof FoundationAccountContextError && error.reason === "forbidden"
          ? {
              status: 403,
              error: "Account access is unavailable",
              reason: "account_access_unavailable",
            }
          : inboxRefusal(error),
  });
}
