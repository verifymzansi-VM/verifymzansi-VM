/**
 * Closing an account from "Delete account" (api.close_my_account, database
 * update 20261116175757_close_and_erase_account). Shared by the profile page
 * and its route, so the dates the dialog promises match the ones the route
 * reports.
 */

/** The word the member types to confirm (the restored dialog's word). */
export const ACCOUNT_CLOSURE_WORD = "DELETE";

/** Whether the typed text confirms, ignoring case and outer spaces as before. */
export function confirmsAccountClosure(value: string): boolean {
  return value.trim().toUpperCase() === ACCOUNT_CLOSURE_WORD;
}

/** What the member is told when the closure was sent but its outcome is unknown. */
export const ACCOUNT_CLOSURE_UNKNOWN_OUTCOME =
  "We couldn't confirm whether your account was closed. Try signing in: if you can't, it was closed. Contact support if unsure.";

/** How recent the member's password or Google sign-in must be (the route's
 * rule; internal.account_closing_actor also counts other sign-in methods). */
export const ACCOUNT_CLOSURE_SIGN_IN_MINUTES = 15;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The deletion request's deadline: 7 days after the 30-day grace period ends
 * (owner decision 16 Nov; internal.close_my_account sets the same due date).
 */
export function accountErasureDeadline(eraseAfter: Date): Date {
  return new Date(eraseAfter.getTime() + 7 * DAY_MS);
}

/**
 * The erasure date and the request's deadline for an account closed at
 * `closedAt`: erased 30 days after closing (internal.close_account_now).
 */
export function accountClosureDates(closedAt: Date): { eraseAfter: Date; eraseBy: Date } {
  const eraseAfter = new Date(closedAt.getTime() + 30 * DAY_MS);
  return { eraseAfter, eraseBy: accountErasureDeadline(eraseAfter) };
}
