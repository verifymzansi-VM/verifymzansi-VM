import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  hasDatabaseMessage,
  hasDatabaseReason,
  isStaffSecondFactorRefusal,
  type FoundationErrorReason,
} from "./error-reasons";
import type { FoundationRefusal } from "./owner-route";
import { FoundationStaffCommandError, staffCommandRefusal } from "./staff-command";
import {
  FREE_CREDIT_DAYS,
  FREE_CREDIT_MESSAGES,
  FREE_CREDIT_POSTS,
  FREE_CREDIT_REASON,
  type FreeCredit,
  type FreeCreditRefusal,
} from "@/lib/admin/free-credits";

/**
 * Staff free credits (database update 20261122130744_free_credits.sql). Giving
 * and extending run through internal.staff_actor('free_credit:give'): admins,
 * with an authenticator code from the last 15 minutes; the list through
 * free_credit:view (the 12-hour rule). A gift is an entitlement with the
 * source free_credit: never charged, never renewed.
 */

type DatabaseError = { code?: string; message?: string; details?: string | null } | null;

/** A refusal the screen words itself (see FREE_CREDIT_MESSAGES). */
class FreeCreditRefused extends Error {
  override name = "FreeCreditRefused";
  constructor(
    readonly status: number,
    readonly reason: FreeCreditRefusal
  ) {
    super(FREE_CREDIT_MESSAGES[reason]);
  }
}

const timestamp = z.iso.datetime({ offset: true });
const listResult = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        member: z.string().min(1).max(260).nullable(),
        posts: z.number().int().min(FREE_CREDIT_POSTS.min).max(FREE_CREDIT_POSTS.max),
        starts_at: timestamp,
        ends_at: timestamp,
        status: z.enum(["active", "ended"]),
        views: z.number().int().nonnegative(),
      })
    )
    .max(500),
});
const changeResult = z.strictObject({
  id: z.uuid(),
  posts: z.number().int().min(FREE_CREDIT_POSTS.min).max(FREE_CREDIT_POSTS.max),
  ends_at: timestamp,
});

/** The database's reasons and the HTTP status each is answered with. */
const REFUSALS: ReadonlyArray<[FreeCreditRefusal & FoundationErrorReason, number]> = [
  ["free_credit_member_not_found", 404],
  ["free_credit_identity_required", 409],
  ["free_credit_own_account", 409],
  ["free_credit_posts_invalid", 422],
  ["free_credit_days_invalid", 422],
  ["free_credit_reason_required", 422],
  ["free_credit_not_found", 404],
  ["free_credit_closed", 409],
];

/** Throws the refusal a database error stands for; unknown errors stay as
 * they are (the route answers them with a generic 503 and a reference). */
function refuse(error: NonNullable<DatabaseError>): never {
  if (error.code === "42501") {
    if (isStaffSecondFactorRefusal(error))
      throw new FoundationStaffCommandError(
        403,
        "Verify your authenticator again, then try again.",
        true
      );
    if (hasDatabaseMessage(error, "capabilityNotGranted"))
      throw new FreeCreditRefused(403, "free_credit_not_allowed");
    throw new FoundationStaffCommandError(
      403,
      "Your staff access changed. Reload the page before continuing."
    );
  }
  for (const [reason, status] of REFUSALS)
    if (hasDatabaseReason(error, reason)) throw new FreeCreditRefused(status, reason);
  throw Object.assign(new Error("Free credit command failed"), { cause: error });
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("Free credit answer could not be confirmed");
  return parsed.data;
}

/** The latest 500 gifts, newest first. */
export async function readFreeCredits(api: FoundationAuthenticatedApi): Promise<FreeCredit[]> {
  const { data, error } = await api.rpc("list_free_credits", {}, { get: false });
  if (error) refuse(error);
  return parse(listResult, data).items.map((row) => ({
    id: row.id,
    member: row.member,
    posts: row.posts,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    views: row.views,
  }));
}

/** Gives the member with this email free posts from now. */
export async function giveFreeCredit(
  api: FoundationAuthenticatedApi,
  input: { email: string; posts: number; days: number; reason: string }
) {
  const { data, error } = await api.rpc(
    "give_free_credit",
    { p_email: input.email, p_posts: input.posts, p_days: input.days, p_reason: input.reason },
    { get: false }
  );
  if (error) refuse(error);
  const result = parse(changeResult, data);
  return { id: result.id, posts: result.posts, endsAt: result.ends_at };
}

/** Adds days to a gift: from its end while it runs, otherwise from now. */
export async function extendFreeCredit(
  api: FoundationAuthenticatedApi,
  input: { id: string; days: number; reason: string }
) {
  const { data, error } = await api.rpc(
    "extend_free_credit",
    { p_credit_id: input.id, p_days: input.days, p_reason: input.reason },
    { get: false }
  );
  if (error) refuse(error);
  const result = parse(changeResult, data);
  return { id: result.id, posts: result.posts, endsAt: result.ends_at };
}

/** Request bodies the route accepts (the database rechecks every rule). */
const reason = z.string().trim().min(FREE_CREDIT_REASON.min).max(FREE_CREDIT_REASON.max);
const days = z.number().int().min(FREE_CREDIT_DAYS.min).max(FREE_CREDIT_DAYS.max);
export const freeCreditRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("give"),
    // Bounded, without control characters (a NUL byte cannot reach the database).
    email: z
      .string()
      .trim()
      .min(3)
      .max(254)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    posts: z.number().int().min(FREE_CREDIT_POSTS.min).max(FREE_CREDIT_POSTS.max),
    days,
    reason,
  }),
  z.strictObject({ action: z.literal("extend"), id: z.uuid(), days, reason }),
]);

const FIELD_REASONS: Record<string, FreeCreditRefusal> = {
  email: "free_credit_member_not_found",
  posts: "free_credit_posts_invalid",
  days: "free_credit_days_invalid",
  reason: "free_credit_reason_required",
};

/** Route refusals: the screen's own reasons, the staff re-verify redirect, a
 * bad field as that field's refusal, and any other malformed request as one. */
export function freeCreditRefusal(error: unknown): FoundationRefusal | null {
  if (error instanceof z.ZodError) {
    const field = error.issues[0]?.path[0];
    const known = typeof field === "string" ? FIELD_REASONS[field] : undefined;
    return known
      ? { status: 422, error: FREE_CREDIT_MESSAGES[known], reason: known }
      : {
          status: 422,
          error: "This request could not be read. Reload the page and try again.",
          reason: "free_credit_request_invalid",
        };
  }
  if (error instanceof FreeCreditRefused)
    return { status: error.status, error: error.message, reason: error.reason };
  return staffCommandRefusal(error);
}
