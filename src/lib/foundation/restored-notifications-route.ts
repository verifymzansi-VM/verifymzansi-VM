import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  foundationNotificationPageSchema,
  markFoundationNotificationsRead,
  FoundationInboxError,
} from "./owner-inbox";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { inboxRefusal } from "@/lib/foundation/inbox-refusal";
import { createBooleanFlagSchema, createBoundedIntegerSchema } from "../validations/shared";
import { createLogger } from "../utils/logger";
const log = createLogger("RestoredNotifications");
const row = foundationNotificationPageSchema.shape.items.element
  .extend({
    kind: z.enum([
      ...foundationNotificationPageSchema.shape.items.element.shape.kind.options,
      "account_warning",
      "content_hidden",
      "account_suspended",
      "account_banned",
      "appeal_decided",
    ]),
    warning_reason: z.string().min(10).max(500).nullable().optional(),
    organisation_slug: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
      .nullable(),
  })
  .refine((n) => n.kind !== "account_warning" || typeof n.warning_reason === "string");
const page = z.strictObject({
  items: z.array(row).max(50),
  unread_count: z.number().int().nonnegative(),
});
const mutation = z.union([
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({ id: z.uuid() }),
]);
const query = z.object({
  limit: createBoundedIntegerSchema({ defaultValue: 25, min: 1, max: 50, fieldName: "limit" }),
  unread: createBooleanFlagSchema(false),
  before: z.iso.datetime({ offset: true }).optional(),
});
function presentedNotification(n: z.infer<typeof row>) {
  const content = {
    account_warning: ["Account warning", n.warning_reason ?? "", "/dashboard", "warning"],
    content_hidden: ["Content hidden", "A post was hidden after review.", "/appeals", "warning"],
    account_suspended: [
      "Account suspension",
      "Check your current decision and its end date.",
      "/appeals",
      "warning",
    ],
    account_banned: [
      "Account ban",
      "Check the decision and your appeal options.",
      "/appeals",
      "warning",
    ],
    appeal_decided: [
      "Your appeal has been decided",
      "Sign in to read the review outcome.",
      "/appeals",
      "info",
    ],
    enquiry_received: [
      "New enquiry",
      "A buyer sent an enquiry about your post.",
      "/dashboard/leads",
      "info",
    ],
    organisation_application_received: [
      "New affiliation application",
      "An organisation application needs your attention.",
      n.organisation_slug
        ? `/dashboard/organisation/${n.organisation_slug}/applications`
        : "/dashboard/affiliations",
      "info",
    ],
    organisation_application_decided: [
      "Affiliation application updated",
      "Your organisation application has been updated.",
      "/dashboard/affiliations",
      "info",
    ],
    organisation_affiliation_ended: [
      "Affiliation ended",
      "Your organisation affiliation has ended.",
      "/dashboard/affiliations",
      "warning",
    ],
    organisation_sponsorship_activated: [
      "Sponsorship activated",
      "Your organisation sponsorship is active.",
      "/dashboard/affiliations",
      "success",
    ],
    organisation_sponsorship_ended: [
      "Sponsorship ended",
      "Your organisation sponsorship has ended.",
      "/dashboard/affiliations",
      "info",
    ],
    partner_commission_approved: [
      "Commission approved",
      "Your partner commission has been approved.",
      "/dashboard/partner",
      "success",
    ],
    partner_commission_reversed: [
      "Commission reversed",
      "Your partner commission has been reversed.",
      "/dashboard/partner",
      "warning",
    ],
  } satisfies Record<z.infer<typeof row>["kind"], string[]>;
  const [title, message, href, type] = content[n.kind];
  return {
    id: n.id,
    title,
    message,
    href,
    type,
    read: n.read_at !== null,
    created_at: n.created_at,
  };
}
export function handleRestoredNotifications(
  request: NextRequest,
  method: "GET" | "PATCH" | "DELETE"
) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: method === "GET" ? "inbox:read" : "inbox:update",
    mutate: method !== "GET",
    unavailableMessage: "Notifications are temporarily unavailable",
    signInMessage: "Sign in to manage notifications",
    command: async (api, input) => {
      const account = await readFoundationAccountContext(api);
      if (method === "GET") {
        const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
        if (!parsed.success) throw new FoundationInboxError("invalid");
        const { data, error } = await api.rpc("list_my_frontend_notices", {
          p_limit: parsed.data.limit,
          p_unread: parsed.data.unread,
          ...(parsed.data.before ? { p_before: parsed.data.before } : {}),
        });
        if (error) throw new FoundationInboxError("unavailable");
        const result = page.parse(data);
        return {
          accountId: account.account_id,
          notifications: result.items.map(presentedNotification),
          unreadCount: result.unread_count,
        };
      }
      const parsed = mutation.safeParse(input);
      if (!parsed.success) throw new FoundationInboxError("invalid");
      const ids = "id" in parsed.data ? { ids: [parsed.data.id] } : {};
      if (method === "PATCH") {
        const result = await markFoundationNotificationsRead(api, ids);
        return { success: true, unreadCount: result.unread_count };
      }
      const { data, error } = await api.rpc(
        "dismiss_my_notifications",
        "ids" in ids ? { p_ids: ids.ids } : {}
      );
      if (error) throw new FoundationInboxError("unavailable");
      const result = z
        .strictObject({
          dismissed: z.number().int().nonnegative(),
          unread_count: z.number().int().nonnegative(),
        })
        .parse(data);
      return { success: true, unreadCount: result.unread_count };
    },
    refusal: (error) =>
      error instanceof FoundationAccountContextError && error.reason === "forbidden"
        ? {
            status: 403,
            error: "Account access is unavailable",
            reason: "account_access_unavailable",
          }
        : inboxRefusal(error),
  });
}
