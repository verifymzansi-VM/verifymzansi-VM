import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { hasDatabaseMessage, hasDatabaseReason, isStaffSecondFactorRefusal } from "./error-reasons";
import type { FoundationRefusal } from "./owner-route";
import { FoundationStaffCommandError, staffCommandRefusal } from "./staff-command";
import type { FoundationSignupMode } from "./signup-mode";
import {
  MEMBER_INVITATION_MESSAGES,
  type MemberInvitation,
  type MemberInvitationRefusal,
} from "@/lib/admin/member-invitations";

/**
 * Staff member invitations (database update
 * 20261120040242_signup_mode_member_invitations.sql). Every command runs
 * through internal.staff_actor('member:invite'): admins only, with an
 * authenticator check in the last 12 hours. A member invitation lets one
 * person create a normal member account; it never grants a staff role.
 */

type DatabaseError = { code?: string; message?: string; details?: string | null } | null;

/** A refusal the screen words itself (see MEMBER_INVITATION_MESSAGES). */
export class MemberInvitationRefused extends Error {
  override name = "MemberInvitationRefused";
  constructor(
    readonly status: number,
    readonly reason: MemberInvitationRefusal
  ) {
    super(MEMBER_INVITATION_MESSAGES[reason]);
  }
}

const timestamp = z.iso.datetime({ offset: true });
const email = z.string().min(3).max(254);

const listResult = z.strictObject({
  items: z
    .array(
      z.strictObject({
        email,
        invited_at: timestamp,
        expires_at: timestamp,
        claimed_at: timestamp.nullable(),
        revoked_at: timestamp.nullable(),
        status: z.enum(["open", "used", "expired", "revoked"]),
        registered: z.boolean(),
      })
    )
    .max(500),
});
const inviteResult = z.strictObject({ email, invited_at: timestamp, expires_at: timestamp });
const withdrawResult = z.strictObject({ email, revoked: z.boolean() });
const signupModeResult = z.strictObject({ mode: z.enum(["invite_only", "open"]) });

/** Throws the refusal a database error stands for; unknown errors stay as
 * they are (the route answers them with a generic 503 and a reference). */
function refuse(error: NonNullable<DatabaseError>): never {
  if (error.code === "42501") {
    if (isStaffSecondFactorRefusal(error))
      throw new FoundationStaffCommandError(
        403,
        "Verify your authenticator again, then reload the page.",
        true
      );
    if (hasDatabaseMessage(error, "capabilityNotGranted"))
      throw new MemberInvitationRefused(403, "member_invitation_not_allowed");
    throw new FoundationStaffCommandError(
      403,
      "Your staff access changed. Reload the page before continuing."
    );
  }
  if (error.code === "PT409" && hasDatabaseReason(error, "member_invitation_account_exists"))
    throw new MemberInvitationRefused(409, "member_invitation_account_exists");
  if (error.code === "54000" && hasDatabaseMessage(error, "memberInvitationLimit"))
    throw new MemberInvitationRefused(429, "member_invitation_limit");
  if (error.code === "22023" && hasDatabaseMessage(error, "memberInvitationEmailInvalid"))
    throw new MemberInvitationRefused(422, "member_invitation_email_invalid");
  throw Object.assign(new Error("Member invitation command failed"), { cause: error });
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("Member invitation answer could not be confirmed");
  return parsed.data;
}

/** The latest 500 invitations, newest first, and the sign-up mode (null when
 * it cannot be read: the screen then leaves out the sentence about it). */
export async function readMemberInvitations(api: FoundationAuthenticatedApi): Promise<{
  mode: FoundationSignupMode | null;
  items: MemberInvitation[];
}> {
  const [list, mode] = await Promise.all([
    api.rpc("list_member_invitations", {}, { get: false }),
    api.rpc("get_signup_mode", {}, { get: false }),
  ]);
  if (list.error) refuse(list.error);
  const parsedMode = mode.error ? null : signupModeResult.safeParse(mode.data);
  return {
    mode: parsedMode?.success ? parsedMode.data.mode : null,
    items: parse(listResult, list.data).items.map((row) => ({
      email: row.email,
      invitedAt: row.invited_at,
      expiresAt: row.expires_at,
      claimedAt: row.claimed_at,
      revokedAt: row.revoked_at,
      status: row.status,
      registered: row.registered,
    })),
  };
}

/** Invites an address, or renews its invitation for 30 more days. */
export async function inviteMember(api: FoundationAuthenticatedApi, address: string) {
  const { data, error } = await api.rpc("invite_member", { p_email: address }, { get: false });
  if (error) refuse(error);
  const result = parse(inviteResult, data);
  return { email: result.email, invitedAt: result.invited_at, expiresAt: result.expires_at };
}

/** Withdraws an invitation; `withdrawn` is false when there was none open. */
export async function withdrawMemberInvitation(api: FoundationAuthenticatedApi, address: string) {
  const { data, error } = await api.rpc(
    "revoke_member_invitation",
    { p_email: address },
    { get: false }
  );
  if (error) refuse(error);
  const result = parse(withdrawResult, data);
  return { email: result.email, withdrawn: result.revoked };
}

/** Route refusals: the screen's own reasons, the staff re-verify redirect, a
 * bad address as an invalid address, and any other malformed request as one. */
export function memberInvitationRefusal(error: unknown): FoundationRefusal | null {
  if (error instanceof z.ZodError)
    return error.issues.length > 0 && error.issues.every((issue) => issue.path[0] === "email")
      ? {
          status: 422,
          error: MEMBER_INVITATION_MESSAGES.member_invitation_email_invalid,
          reason: "member_invitation_email_invalid",
        }
      : {
          status: 422,
          error: "This request could not be read. Reload the page and try again.",
          reason: "member_invitation_request_invalid",
        };
  if (error instanceof MemberInvitationRefused)
    return { status: error.status, error: error.message, reason: error.reason };
  return staffCommandRefusal(error);
}
