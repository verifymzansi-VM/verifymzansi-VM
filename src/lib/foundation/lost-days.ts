import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  hasDatabaseMessage,
  isStaffSecondFactorRefusal,
  lookupDatabaseReason,
  type FoundationErrorReason,
} from "./error-reasons";
import { FoundationStaffCommandError } from "./staff-command";
import {
  LOST_DAYS,
  LOST_DAYS_REASON,
  type LostDaysMove,
  type LostDaysTerm,
} from "@/lib/admin/lost-days";

/**
 * Adding lost days (database update 20261125113433_add_lost_days.sql). The
 * preview runs through internal.staff_actor('payments:view'), the change
 * through payments:refund (admins, with an authenticator code from the last
 * 15 minutes). Both follow the staff rule of money actions: the staff member
 * has an accepted ID review of their own and never acts for their own account.
 */

type DatabaseError = { code?: string; message?: string; details?: string | null } | null;

/** The database's reasons, with the status and words the panel shows. */
const REFUSALS: ReadonlyMap<FoundationErrorReason, [number, string]> = new Map([
  ["lost_days_member_not_found", [404, "No active member account has this email."]],
  [
    "lost_days_nothing_running",
    [
      409,
      "This member has no running paid slot or package, so there is nothing to add days to. An ended slot gets a refund instead.",
    ],
  ],
  [
    "lost_days_limit",
    [
      409,
      "A slot can get at most 30 lost days in all, and this would go over. Refund the member instead.",
    ],
  ],
  ["lost_days_busy", [409, "The member's slots changed just now. Check them again, then retry."]],
  [
    "lost_days_request_reused",
    [409, "This change was already sent with other details. Reload the page and start again."],
  ],
  ["lost_days_days_invalid", [422, `Choose ${LOST_DAYS.min} to ${LOST_DAYS.max} days.`]],
  [
    "lost_days_reason_required",
    [
      422,
      `Write a reason of ${LOST_DAYS_REASON.min} to ${LOST_DAYS_REASON.max} characters on one line.`,
    ],
  ],
  ["lost_days_request_invalid", [422, "Reload the page and try again."]],
  ["staff_review_required", [403, "You need an accepted ID review of your own to add days."]],
  [
    "staff_same_identity",
    [403, "Another staff member must add days to your own account or another account of yours."],
  ],
]);

/** Throws the refusal a database error stands for; unknown errors stay
 * errors (the route answers them with a generic 503 and a reference). */
function refuse(error: NonNullable<DatabaseError>): never {
  const known = lookupDatabaseReason(REFUSALS, error);
  if (known) throw new FoundationStaffCommandError(known[0], known[1]);
  if (error.code === "42501") {
    if (isStaffSecondFactorRefusal(error))
      throw new FoundationStaffCommandError(
        403,
        "Verify your authenticator again, then try again.",
        true
      );
    if (hasDatabaseMessage(error, "capabilityNotGranted"))
      throw new FoundationStaffCommandError(403, "Only admins can add lost days.");
    throw new FoundationStaffCommandError(
      403,
      "Your staff access changed. Reload the page before continuing."
    );
  }
  throw Object.assign(new Error("Lost days command failed"), { cause: error });
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("Lost days answer could not be confirmed");
  return parsed.data;
}

const timestamp = z.iso.datetime({ offset: true });
const term = {
  kind: z.enum(["individual", "package"]),
  id: z.uuid(),
  slots: z.number().int().min(1).max(1000),
  renewals: z.number().int().min(0).max(1000),
};
const previewResult = z.strictObject({
  items: z.array(z.strictObject({ ...term, ends_at: timestamp })).max(1000),
});
const addResult = z.strictObject({
  request_id: z.uuid(),
  days: z.number().int().min(LOST_DAYS.min).max(LOST_DAYS.max),
  repeated: z.boolean(),
  items: z
    .array(z.strictObject({ ...term, ends_before: timestamp, ends_after: timestamp }))
    .min(1)
    .max(1000),
});

/** The member's running paid slots and package (records nothing). */
export async function previewLostDays(
  api: FoundationAuthenticatedApi,
  email: string
): Promise<{ items: LostDaysTerm[] }> {
  const { data, error } = await api.rpc(
    "get_lost_days_preview",
    { p_email: email.trim() },
    { get: false }
  );
  if (error) refuse(error);
  return {
    items: parse(previewResult, data).items.map((item) => ({
      kind: item.kind,
      id: item.id,
      slots: item.slots,
      renewals: item.renewals,
      endsAt: item.ends_at,
    })),
  };
}

/** Adds `days` to every running paid slot and package of the member. */
export async function addLostDays(
  api: FoundationAuthenticatedApi,
  input: { email: string; days: number; reason: string; requestId: string }
): Promise<{ days: number; repeated: boolean; items: LostDaysMove[] }> {
  const { data, error } = await api.rpc(
    "add_lost_days",
    {
      p_email: input.email.trim(),
      p_days: input.days,
      p_reason: input.reason.trim(),
      p_request_id: input.requestId,
    },
    { get: false }
  );
  if (error) refuse(error);
  const result = parse(addResult, data);
  if (result.request_id !== input.requestId.toLowerCase() || result.days !== input.days)
    throw new Error("Lost days answer could not be confirmed");
  return {
    days: result.days,
    repeated: result.repeated,
    items: result.items.map((item) => ({
      kind: item.kind,
      id: item.id,
      slots: item.slots,
      renewals: item.renewals,
      endsBefore: item.ends_before,
      endsAfter: item.ends_after,
    })),
  };
}

/** Bounded, without control characters (a NUL byte cannot reach the database). */
const email = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .regex(/^[^\x00-\x1f\x7f]+$/);

/** The commercial route's request bodies (the database rechecks every rule). */
export const lostDaysPreviewInput = z.object({
  action: z.literal("slots.lost_days_preview"),
  accountEmail: email,
});
export const lostDaysAddInput = z.object({
  action: z.literal("slots.add_lost_days"),
  accountEmail: email,
  days: z.number().int().min(LOST_DAYS.min).max(LOST_DAYS.max),
  reason: z.string().trim().min(LOST_DAYS_REASON.min).max(LOST_DAYS_REASON.max),
  requestId: z.uuid(),
});
