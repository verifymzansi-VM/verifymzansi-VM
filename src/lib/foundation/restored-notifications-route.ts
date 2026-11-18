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
/** Account events that reach the bell beside their email
 * (20261117140533_member_notices_in_app.sql). */
const MEMBER_EVENT_KINDS = [
  "identity_accepted",
  "verification_phone_confirmed",
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
  "trial_started",
  "post_approved",
  "post_rejected",
  "post_changes_approved",
  "post_changes_rejected",
  "post_expired",
  "post_sold",
  "post_kept",
  "draft_deletion_warning",
  "post_deleted",
  "slot_renewal_reminder",
  "invoice_issued",
  "content_restored",
  // 20261118072601_staff_data_minimisation.sql: a privacy (data) request
  // naming the account was approved, and its export was made.
  "privacy_request_approved",
  "privacy_export_made",
] as const;
const row = foundationNotificationPageSchema.shape.items.element
  .extend({
    kind: z.enum([
      ...foundationNotificationPageSchema.shape.items.element.shape.kind.options,
      "account_warning",
      "content_hidden",
      "account_suspended",
      "account_banned",
      "appeal_decided",
      "business_check_update",
      "verification_returned",
      ...MEMBER_EVENT_KINDS,
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
const knownKinds: ReadonlySet<unknown> = new Set(row.shape.kind.options);
/** A notice of a kind this release cannot present yet (a database update
 * applied ahead of its website) is left out, so it cannot hide every other
 * notice behind an error. A known notice that is malformed is still refused. */
function withoutUnknownKinds(data: unknown): { data: unknown; unreadLeftOut: number } {
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { items?: unknown }).items)
  )
    return { data, unreadLeftOut: 0 };
  const items = (data as { items: unknown[] }).items;
  const isKnown = (item: unknown) =>
    typeof item !== "object" || item === null || knownKinds.has((item as { kind?: unknown }).kind);
  const unknown = items.filter((item) => !isKnown(item));
  if (unknown.length === 0) return { data, unreadLeftOut: 0 };
  log.warn("Left out notifications of a kind this release does not know", {
    count: unknown.length,
  });
  return {
    data: { ...data, items: items.filter(isKnown) },
    // The badge counts only what the list can show.
    unreadLeftOut: unknown.filter((item) => (item as { read_at?: unknown }).read_at === null)
      .length,
  };
}
/** The post's title in quotes, or a plain fallback. */
function postName(title: string | null, fallback: string) {
  const trimmed = title?.trim();
  return trimmed ? `\u201c${trimmed}\u201d` : fallback;
}
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
  const post = postName(n.post_title, "your post");
  const Post = postName(n.post_title, "Your post");
  const content = {
    identity_accepted: [
      "Your ID check was accepted",
      "Your identity is verified. Open verification to see any steps that remain.",
      "/verification",
      "success",
    ],
    verification_phone_confirmed: [
      "Mobile number verified",
      "Your mobile number was verified on your account. Not you? Contact support.",
      "/verification",
      "success",
    ],
    payment_completed: [
      "Payment received",
      "We received your payment. Your receipt and invoice were emailed to you.",
      "/dashboard/slots",
      "success",
    ],
    payment_reversed: [
      "Refund recorded",
      "Part or all of a payment was refunded or reversed. The details were emailed to you.",
      "/dashboard/slots",
      "warning",
    ],
    payment_reconciliation_required: [
      "Payment being checked",
      "We received your payment but could not apply it automatically. We are checking it; there is no need to pay again.",
      "/dashboard/slots",
      "info",
    ],
    invoice_issued: [
      "New invoice to pay",
      "An invoice was issued to your account. Open it to see the amount and how to pay.",
      "/billing/invoices",
      "info",
    ],
    privacy_request_approved: [
      "Your data request was approved",
      "A second staff member approved your data request. We will email you at the address on the request.",
      "/dsar",
      "info",
    ],
    privacy_export_made: [
      "Your data export was made",
      "The copy of your data you asked for was prepared. It is sent to the email address on your request.",
      "/dsar",
      "info",
    ],
    content_restored: [
      "Your post is visible again",
      `${Post} was reviewed and is showing again.`,
      "/dashboard/listings",
      "success",
    ],
    trial_started: [
      "Your introductory posting allowance is ready",
      "Your free introductory period has started. Your dashboard shows when it ends.",
      "/dashboard",
      "success",
    ],
    post_approved: [
      "Your post is live",
      `${Post} was approved and is now live.`,
      "/dashboard/listings",
      "success",
    ],
    post_rejected: [
      "Post not approved",
      `${Post} was not approved. Open your posts to see why and what to change.`,
      "/dashboard/listings",
      "warning",
    ],
    post_changes_approved: [
      "Your changes are live",
      `Your changes to ${post} were approved.`,
      "/dashboard/listings",
      "success",
    ],
    post_changes_rejected: [
      "Changes not approved",
      `Your changes to ${post} were not approved. Open your posts to see why.`,
      "/dashboard/listings",
      "warning",
    ],
    post_expired: [
      "Post expired",
      `${Post} is no longer shown. Reactivate it from your posts to keep it, or it will be deleted with its photos and videos.`,
      "/dashboard/listings",
      "warning",
    ],
    post_sold: [
      "Post marked as sold",
      `${Post} is marked as sold and will be deleted shortly. Marked it by mistake? Reactivate it from your posts.`,
      "/dashboard/listings",
      "info",
    ],
    post_kept: [
      "Post kept after your payment",
      `Your payment is confirmed, so ${post} is kept for a few more days. Reactivate it to show it again.`,
      "/dashboard/listings",
      "success",
    ],
    draft_deletion_warning: [
      "Post will be deleted soon",
      `${Post} is not showing and has not been changed for 45 days. Update it within about 15 days to keep it, or it will be deleted with its photos and videos.`,
      "/dashboard/listings",
      "warning",
    ],
    post_deleted: [
      "Post deleted",
      "One of your posts was deleted, with its photos and videos.",
      "/dashboard/listings",
      "info",
    ],
    slot_renewal_reminder: [
      "Your slot ends soon",
      "One of your slots ends within 3 days. Renew it now so your post stays live without a break.",
      "/dashboard/slots",
      "warning",
    ],
    business_check_update: [
      "Business verification update",
      "Open your business verification to see the details.",
      n.post_id ? `/dashboard/businesses/${n.post_id}/verification` : "/dashboard/businesses",
      "info",
    ],
    account_warning: ["Account warning", n.warning_reason ?? "", "/dashboard", "warning"],
    verification_returned: [
      "Your ID check needs another look",
      "Your ID was sent back. Open verification to see why and what to do next.",
      "/verification",
      "warning",
    ],
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
        const known = withoutUnknownKinds(data);
        const result = page.parse(known.data);
        return {
          accountId: account.account_id,
          notifications: result.items.map(presentedNotification),
          unreadCount: Math.max(0, result.unread_count - known.unreadLeftOut),
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
