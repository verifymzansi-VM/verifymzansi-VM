import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  hasDatabaseMessage,
  isStaffSecondFactorRefusal,
  lookupDatabaseReason,
  type FoundationErrorReason,
} from "./error-reasons";
import { FoundationStaffCommandError } from "./staff-command";

/**
 * Releasing one phone number a ban blocks (database update
 * 20261125213005_release_one_phone_number.sql). One staff member asks, a
 * different one approves; both need account:restore (admins and governors,
 * with an authenticator code from the last 15 minutes). The ID ban stays.
 */

/** A number exactly as the database stores it. */
export const BLOCKED_PHONE_PATTERN = /^\+27[0-9]{9}$/;
export const RELEASE_REASON = { min: 10, max: 500 } as const;

type DatabaseError = { code?: string; message?: string; details?: string | null } | null;

/** The database's reasons, with the status and words the card shows. */
const REFUSALS: ReadonlyMap<FoundationErrorReason, [number, string]> = new Map([
  [
    "phone_not_blocked",
    [404, "No running ban blocks this number, so there is nothing to release."],
  ],
  [
    "phone_release_pending",
    [409, "Someone already asked to release this number. Approve or reject that request instead."],
  ],
  [
    "phone_release_not_pending",
    [409, "No request to release this number is waiting any more. Reload the page."],
  ],
  [
    "phone_release_same_staff",
    [403, "A different staff member must approve a release you asked for."],
  ],
  [
    "phone_release_conflict",
    [403, "You verified this number yourself, so another staff member must handle it."],
  ],
  [
    "phone_release_changed",
    [409, "The person who asked no longer has this permission. Reject the request and ask again."],
  ],
]);

function refuse(error: NonNullable<DatabaseError>): never {
  const known = lookupDatabaseReason(REFUSALS, error);
  if (known) throw new FoundationStaffCommandError(known[0], known[1]);
  if (error.code === "22023")
    throw new FoundationStaffCommandError(
      422,
      `Check the number and write a reason of ${RELEASE_REASON.min} to ${RELEASE_REASON.max} characters on one line.`
    );
  // Unknown errors stay errors (the route answers a generic 503).
  if (error.code !== "42501")
    throw Object.assign(new Error("Phone release command failed"), { cause: error });
  const mfa = isStaffSecondFactorRefusal(error);
  const message = mfa
    ? "Verify your authenticator again, then try again."
    : hasDatabaseMessage(error, "capabilityNotGranted")
      ? "Only admins and governors can release numbers."
      : "Your staff access changed. Reload the page before continuing.";
  throw new FoundationStaffCommandError(403, message, mfa);
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("Phone release answer could not be confirmed");
  return parsed.data;
}

const timestamp = z.iso.datetime({ offset: true });
const phone = z.string().regex(BLOCKED_PHONE_PATTERN);
const reason = z.string().min(RELEASE_REASON.min).max(RELEASE_REASON.max);
const name = z.string().max(120).nullable();
const releasesResult = z.strictObject({
  actor_id: z.uuid(),
  pending: z
    .array(
      z.strictObject({
        phone,
        reason,
        proposed_at: timestamp,
        expires_at: timestamp,
        proposed_by_name: name,
        proposed_by_me: z.boolean(),
        conflicted: z.boolean(),
      })
    )
    .max(1000),
  released: z
    .array(
      z.strictObject({
        phone,
        reason,
        proposed_by_name: name,
        released_by_name: name,
        released_at: timestamp,
      })
    )
    .max(50),
});
export type PhoneReleases = z.infer<typeof releasesResult>;

/** Waiting requests and the latest releases (records nothing). */
export async function readPhoneReleases(
  api: FoundationAuthenticatedApi,
  callerId: string
): Promise<PhoneReleases> {
  const { data, error } = await api.rpc("get_phone_number_releases", {}, { get: false });
  if (error) refuse(error);
  const result = parse(releasesResult, data);
  if (result.actor_id !== callerId) throw new Error("Phone releases belong to another session");
  return result;
}

/** Asks to release `number` (+27 and 9 digits). */
export async function proposePhoneRelease(
  api: FoundationAuthenticatedApi,
  number: string,
  why: string
): Promise<{ status: "proposed" }> {
  const { data, error } = await api.rpc(
    "propose_phone_number_release",
    { p_phone: number, p_reason: why },
    { get: false }
  );
  if (error) refuse(error);
  return parse(
    z.strictObject({
      phone: z.literal(number),
      status: z.literal("proposed"),
      reused: z.boolean().optional(),
    }),
    data
  );
}

/** Approves or rejects the waiting request for `number`. */
export async function reviewPhoneRelease(
  api: FoundationAuthenticatedApi,
  number: string,
  approve: boolean
): Promise<{ status: "released" | "rejected" }> {
  const { data, error } = await api.rpc(
    "review_phone_number_release",
    { p_phone: number, p_approve: approve },
    { get: false }
  );
  if (error) refuse(error);
  return parse(
    z.strictObject({
      phone: z.literal(number),
      status: z.literal(approve ? "released" : "rejected"),
      reused: z.boolean().optional(),
    }),
    data
  );
}
