/** Sensitive actions need a second factor verified within this window. */
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

/** Any staff access needs an authenticator code verified within this window. */
export const STAFF_SESSION_MFA_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Where staff enrol or verify their authenticator app. */
export const STAFF_MFA_PATH = "/staff/two-step";

export type StaffMfaState =
  /** Kept for the restored back-office pages; the live policy never returns it. */
  | { status: "not_enforced" }
  /** The session used its authenticator app within the last 12 hours. */
  | { status: "verified"; lastVerifiedAt: Date | null }
  /** Kept for the restored back-office pages; the live policy has no grace period. */
  | { status: "grace"; graceEndsAt: Date }
  /** Access is blocked until the staff member enrols or verifies. */
  | { status: "required"; hasFactor: boolean };

/** What the live backend reports about a staff session's second factor. */
export interface StaffMfaFacts {
  /**
   * The database's staff check passes for this session now
   * (internal.staff_actor through get_my_account_context): a live session
   * raised with a second factor, an active account, a verified authenticator
   * app and an authenticator code within the last 12 hours.
   */
  canAccess: boolean;
  /** The account has a verified authenticator app. */
  totpEnrolled: boolean;
  /** When this session last used its authenticator app (seconds), read from
   * the Auth-verified token, or null. */
  authenticatorAt: number | null;
}

/**
 * Decide whether a staff session satisfies the MFA policy.
 *
 * - The database refuses the session (no verified authenticator app, no code
 *   in this session, or the last code is older than 12 hours) → required.
 * - The session's own authenticator time is missing or older than 12 hours →
 *   required, even if the database answer said otherwise (fail closed).
 * - Otherwise verified, with the time of the last code for the 15-minute
 *   step-up check. There is no grace period and no switch that turns this off.
 */
export function evaluateStaffMfa(facts: StaffMfaFacts, now: Date = new Date()): StaffMfaState {
  const lastVerifiedAt =
    typeof facts.authenticatorAt === "number" &&
    Number.isSafeInteger(facts.authenticatorAt) &&
    facts.authenticatorAt > 0
      ? new Date(facts.authenticatorAt * 1000)
      : null;
  if (facts.canAccess && lastVerifiedAt) {
    const ageMs = now.getTime() - lastVerifiedAt.getTime();
    if (Number.isFinite(ageMs) && ageMs <= STAFF_SESSION_MFA_MAX_AGE_MS)
      return { status: "verified", lastVerifiedAt };
  }
  return { status: "required", hasFactor: facts.totpEnrolled };
}

/**
 * Whether a sensitive action (role grants, KYC overrides, DSAR exports) may
 * proceed: the second factor must have been verified within the step-up
 * window.
 */
export function hasRecentSecondFactor(state: StaffMfaState, now: Date = new Date()): boolean {
  if (state.status !== "verified" || !state.lastVerifiedAt) return false;
  const ageMs = now.getTime() - state.lastVerifiedAt.getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= STEP_UP_WINDOW_MS;
}
