import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { normalizeSaPhone } from "../utils/phone";

// Same character rule as internal.plain_text_valid: no control (except newline
// in multiline text), zero-width or bidirectional override characters.
const UNSAFE: [number, number][] = [
  [1, 9],
  [11, 31],
  [127, 159],
  [173, 173],
  [1564, 1564],
  [6158, 6158],
  [8203, 8207],
  [8232, 8238],
  [8288, 8303],
  [65279, 65279],
  [65529, 65531],
];
export function isPlainText(value: string, min: number, max: number, multiline: boolean) {
  const characters = Array.from(value);
  return (
    value.normalize("NFC") === value &&
    characters.length >= min &&
    characters.length <= max &&
    !/^[ \n]|[ \n]$/.test(value) &&
    (multiline || !value.includes("\n")) &&
    characters.every((character) => {
      const code = character.codePointAt(0) as number;
      return !UNSAFE.some(([low, high]) => code >= low && code <= high);
    })
  );
}
const plain = (min: number, max: number, multiline: boolean) =>
  z
    .string()
    .max(max * 4)
    .transform((value) =>
      value
        .replace(/\r\n?/g, "\n")
        .replace(/^[ \n]+|[ \n]+$/g, "")
        .normalize("NFC")
    )
    .refine((value) => isPlainText(value, min, max, multiline));
// Same address rule as internal.enquiry_email_valid, after lower-casing.
const email = z
  .string()
  .max(254)
  .transform((value) => value.trim().toLowerCase())
  .refine((value) =>
    /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(?:[.][a-z0-9-]+)*[.][a-z]{2,63}$/.test(value)
  );
const phone = z
  .string()
  .max(32)
  .transform((value) => normalizeSaPhone(value))
  .refine((value) => /^[+]27[0-9]{9}$/.test(value));
const instant = z
  .string()
  .regex(
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/
  )
  .pipe(z.iso.datetime({ offset: true }));

export class FoundationInboxError extends Error {
  constructor(
    readonly reason:
      | "invalid"
      | "post_unavailable"
      | "enquiries_disabled"
      | "own_post"
      | "sender_inactive"
      | "limited"
      | "conflict"
      | "unavailable"
  ) {
    super(`Foundation inbox request failed: ${reason}`);
  }
}
const refusals = new Map<string, FoundationInboxError["reason"]>([
  ["enquiry_invalid", "invalid"],
  ["inbox_page_invalid", "invalid"],
  ["enquiry_status_invalid", "invalid"],
  ["notification_ids_invalid", "invalid"],
  ["post_unavailable", "post_unavailable"],
  ["enquiries_disabled", "enquiries_disabled"],
  ["own_post", "own_post"],
  ["sender_inactive", "sender_inactive"],
  ["enquiry_limit", "limited"],
  ["enquiry_request_conflict", "conflict"],
]);
type InboxRpc = PromiseLike<{ data: unknown; error: { details?: string | null } | null }>;
/** One request, no automatic retry after an uncertain reply. */
async function settle<T>(request: InboxRpc, schema: z.ZodType<T>) {
  const { data, error } = await Promise.resolve(request).then(
    (result) => result,
    () => {
      throw new FoundationInboxError("unavailable");
    }
  );
  if (error)
    throw new FoundationInboxError((error.details && refusals.get(error.details)) || "unavailable");
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new FoundationInboxError("unavailable");
  return parsed.data;
}

const enquiryInput = z.strictObject({
  request_id: z.uuid(),
  post_id: z.uuid(),
  buyer_name: plain(2, 80, false).optional(),
  buyer_email: email,
  buyer_phone: phone.optional(),
  message: plain(10, 1000, true),
});
/** The sender is the GoTrue-verified caller, or null for a signed-out visitor;
 * it is never read from the request body. */
export function buildFoundationEnquiry(input: unknown, sender: string | null) {
  const parsed = enquiryInput.safeParse(input);
  if (!parsed.success || (sender !== null && !z.uuid().safeParse(sender).success))
    throw new FoundationInboxError("invalid");
  const value = parsed.data;
  return {
    p_request_id: value.request_id.toLowerCase(),
    p_post_id: value.post_id.toLowerCase(),
    p_buyer_email: value.buyer_email,
    p_message: value.message,
    ...(sender === null ? {} : { p_sender: sender }),
    ...(value.buyer_name === undefined ? {} : { p_buyer_name: value.buyer_name }),
    ...(value.buyer_phone === undefined ? {} : { p_buyer_phone: value.buyer_phone }),
  };
}
const submitted = z.strictObject({ id: z.uuid(), reused: z.boolean() });
export async function submitFoundationEnquiry(
  api: FoundationServiceApi,
  command: ReturnType<typeof buildFoundationEnquiry>
) {
  return settle(api.rpc("submit_enquiry", command), submitted);
}

const enquiryStatus = z.enum(["new", "read", "contacted", "closed"]);
const cursor = z.strictObject({ before_created: instant, before_id: z.uuid() });
const enquiry = z.strictObject({
  id: z.uuid(),
  post_id: z.uuid(),
  post_kind: z.enum(["listing", "business", "event"]),
  post_title: z.string().nullable(),
  buyer_name: z.string().nullable(),
  buyer_email: z.string(),
  buyer_phone: z.string().nullable(),
  email_confirmed: z.boolean(),
  message: z.string(),
  status: enquiryStatus,
  created_at: instant,
  updated_at: instant,
});
const enquiryPage = z.strictObject({
  items: z.array(enquiry).max(50),
  unread_count: z.number().int().min(0),
  next_cursor: cursor.nullable(),
});
const pageInput = z.strictObject({
  limit: z.number().int().min(1).max(50).default(25),
  status: enquiryStatus.optional(),
  cursor: cursor.optional(),
});
export async function readFoundationEnquiries(
  api: FoundationAuthenticatedApi,
  input: unknown = {}
) {
  const parsed = pageInput.safeParse(input);
  if (!parsed.success) throw new FoundationInboxError("invalid");
  const { limit, status, cursor: after } = parsed.data;
  return settle(
    api.rpc("list_my_enquiries", {
      p_limit: limit,
      ...(status === undefined ? {} : { p_status: status }),
      ...(after === undefined
        ? {}
        : { p_before_created: after.before_created, p_before_id: after.before_id }),
    }),
    enquiryPage
  );
}

const statusInput = z.strictObject({
  id: z.uuid(),
  status: z.enum(["read", "contacted", "closed"]),
});
const statusResult = z
  .strictObject({ id: z.uuid(), status: enquiryStatus, updated_at: instant })
  .nullable();
/** Returns null for a missing or foreign enquiry (indistinguishable). */
export async function setFoundationEnquiryStatus(api: FoundationAuthenticatedApi, input: unknown) {
  const parsed = statusInput.safeParse(input);
  if (!parsed.success) throw new FoundationInboxError("invalid");
  return settle(
    api.rpc("set_enquiry_status", {
      p_id: parsed.data.id.toLowerCase(),
      p_status: parsed.data.status,
    }),
    statusResult
  );
}

const notification = z.strictObject({
  id: z.uuid(),
  kind: z.enum([
    "enquiry_received",
    "organisation_application_received",
    "organisation_application_decided",
    "organisation_affiliation_ended",
    "organisation_sponsorship_activated",
    "organisation_sponsorship_ended",
    "partner_commission_approved",
    "partner_commission_reversed",
  ]),
  post_id: z.uuid().nullable(),
  post_title: z.string().nullable(),
  organisation_name: z.string().nullable(),
  created_at: instant,
  read_at: instant.nullable(),
});
const notificationPage = z.strictObject({
  items: z.array(notification).max(50),
  unread_count: z.number().int().min(0),
  next_cursor: cursor.nullable(),
});
export const foundationNotificationPageSchema = notificationPage;
const notificationPageInput = z.strictObject({
  limit: z.number().int().min(1).max(50).default(25),
  cursor: cursor.optional(),
});
export async function readFoundationNotifications(
  api: FoundationAuthenticatedApi,
  input: unknown = {}
) {
  const parsed = notificationPageInput.safeParse(input);
  if (!parsed.success) throw new FoundationInboxError("invalid");
  const after = parsed.data.cursor;
  return settle(
    api.rpc("list_my_notifications", {
      p_limit: parsed.data.limit,
      ...(after === undefined
        ? {}
        : { p_before_created: after.before_created, p_before_id: after.before_id }),
    }),
    notificationPage
  );
}

const markInput = z.strictObject({ ids: z.array(z.uuid()).min(1).max(100).optional() });
const marked = z.strictObject({
  marked: z.number().int().min(0),
  unread_count: z.number().int().min(0),
});
/** Marks the given notifications, or all of them when ids are omitted. */
export async function markFoundationNotificationsRead(
  api: FoundationAuthenticatedApi,
  input: unknown
) {
  const parsed = markInput.safeParse(input);
  if (!parsed.success) throw new FoundationInboxError("invalid");
  const ids = parsed.data.ids?.map((id) => id.toLowerCase());
  return settle(
    api.rpc("mark_my_notifications_read", ids === undefined ? {} : { p_ids: ids }),
    marked
  );
}

const counts = z.strictObject({
  unread_enquiries: z.number().int().min(0),
  unread_notifications: z.number().int().min(0),
});
export async function readFoundationInboxCounts(api: FoundationAuthenticatedApi) {
  return settle(api.rpc("get_my_inbox_counts"), counts);
}

/** Private Realtime topic for an account's content-free inbox signals. */
export function foundationOwnerInboxTopic(accountId: string) {
  return `owner:${z.uuid().parse(accountId).toLowerCase()}`;
}
