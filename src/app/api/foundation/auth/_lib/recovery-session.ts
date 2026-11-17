/** A session opened by a reset link sets a password only on the reset page,
 * where that link's binding is checked. Elsewhere (password change, password
 * setup) it could skip that check, so those commands refuse it with this
 * answer, whatever the link's age. Email change refuses it too, with its own
 * message (email-change.ts). */
export const RECOVERY_SESSION_REFUSAL = {
  error: "Use the reset link from your email to set a new password",
  reason: "recovery_session",
} as const;

/** Whether the GoTrue-verified caller's session was opened by a reset link
 * (or by another emailed link redeemed straight at Auth; recovery-claims.ts). */
export function openedByResetLink(caller: { recovery: unknown; openedByRecovery: boolean }) {
  return Boolean(caller.recovery) || caller.openedByRecovery;
}
