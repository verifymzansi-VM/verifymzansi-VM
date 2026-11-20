/**
 * What the staff "Member invitations" screen shows for each invitation, and
 * the words for each answer of the invite command. Safe in client components:
 * no locale or time-zone APIs, so the server and the browser agree.
 *
 * A member invitation lets one person create a normal member account with
 * that email address. It never gives staff access: staff are made on Staff
 * roles, administrators only by the database owner.
 */

/** One row of api.list_member_invitations(), as the website passes it on. */
export interface MemberInvitation {
  email: string;
  invitedAt: string;
  expiresAt: string;
  claimedAt: string | null;
  revokedAt: string | null;
  status: "open" | "used" | "expired" | "revoked";
  /** The account that used the invitation still exists. */
  registered: boolean;
}

type MemberInvitationState = "waiting" | "joined" | "withdrawn" | "expired";

interface MemberInvitationView {
  state: MemberInvitationState;
  label: string;
  badge: "pending" | "live" | "draft";
  /** The one date shown beside the status. */
  dateLine: string;
  /** Only an invitation still waiting to be used can be withdrawn. */
  canWithdraw: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/** "19 Dec 2026", in South African time. Empty for an unreadable date. */
export function formatInvitationDate(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const sast = new Date(time + SAST_OFFSET_MS);
  return `${sast.getUTCDate()} ${MONTHS[sast.getUTCMonth()]} ${sast.getUTCFullYear()}`;
}

/** The address as the database keys it (trimmed, lower case). */
export function normaliseInvitationEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function memberInvitationView(row: MemberInvitation): MemberInvitationView {
  // Someone who signed up with the invitation has joined, whatever happened
  // to the invitation afterwards.
  if (row.registered || row.status === "used")
    return {
      state: "joined",
      label: "Joined",
      badge: "live",
      dateLine: `Invited ${formatInvitationDate(row.invitedAt)}`,
      canWithdraw: false,
    };
  if (row.status === "revoked")
    return {
      state: "withdrawn",
      label: "Withdrawn",
      badge: "draft",
      dateLine: `Withdrawn ${formatInvitationDate(row.revokedAt ?? row.invitedAt)}`,
      canWithdraw: false,
    };
  if (row.status === "expired")
    return {
      state: "expired",
      label: "Expired",
      badge: "draft",
      dateLine: `Expired ${formatInvitationDate(row.expiresAt)}`,
      canWithdraw: false,
    };
  return {
    state: "waiting",
    label: "Waiting to join",
    badge: "pending",
    dateLine: `Lasts until ${formatInvitationDate(row.expiresAt)}`,
    canWithdraw: true,
  };
}

/** True when inviting this address renews an invitation still waiting to be
 * used (the command renews it for 30 more days instead of refusing). */
export function renewsWaitingInvitation(rows: readonly MemberInvitation[], email: string): boolean {
  const clean = normaliseInvitationEmail(email);
  return rows.some((row) => row.email === clean && memberInvitationView(row).state === "waiting");
}

/** Stable reasons the invitation route gives for a refusal. */
export type MemberInvitationRefusal =
  | "member_invitation_account_exists"
  | "member_invitation_limit"
  | "member_invitation_email_invalid"
  | "member_invitation_not_allowed";

export const MEMBER_INVITATION_MESSAGES: Record<MemberInvitationRefusal, string> = {
  member_invitation_account_exists: "This email already has an account.",
  member_invitation_limit: "You've reached today's limit of 200 invitations. Try again tomorrow.",
  member_invitation_email_invalid: "Enter a valid email address.",
  member_invitation_not_allowed: "Only admins can invite members.",
};

/** The address shown for a link: no protocol, no trailing slash. */
export function displayLink(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}
