import type { AMREntry, SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

/** Feature flag that turns staff MFA enforcement on (kill switch when off). */
export const STAFF_MFA_FLAG = "staff_mfa_enforced";

/** Sensitive actions need a second factor verified within this window. */
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

/** Where staff enrol or verify their authenticator app. */
export const STAFF_MFA_PATH = "/staff/two-step";

export type StaffMfaState =
  /** Enforcement is switched off by the feature flag. */
  | { status: "not_enforced" }
  /** The session was verified with a second factor (AAL2). */
  | { status: "verified"; lastVerifiedAt: Date | null }
  /** No factor yet, but still inside the enrolment grace period. */
  | { status: "grace"; graceEndsAt: Date }
  /** Access is blocked until the staff member enrols or verifies. */
  | { status: "required"; hasFactor: boolean };

const SECOND_FACTOR_METHODS = new Set(["totp", "mfa/totp", "webauthn", "mfa/webauthn", "phone", "mfa/phone"]);

function lastSecondFactorAt(methods: AMREntry[] | string[]): Date | null {
  let latest = 0;
  for (const entry of methods) {
    if (typeof entry === "string") continue;
    if (SECOND_FACTOR_METHODS.has(entry.method) && entry.timestamp > latest) {
      latest = entry.timestamp;
    }
  }
  // AMR timestamps are seconds since the epoch.
  return latest > 0 ? new Date(latest * 1000) : null;
}

/**
 * Decide whether a staff session satisfies the MFA policy.
 *
 * - Enrolled but not verified this session → required (verify now).
 * - Not enrolled → allowed until `mfaRequiredAfter`, then required.
 * - If the assurance level cannot be read, the grace period still applies but
 *   nothing is treated as verified (fail closed).
 */
export async function evaluateStaffMfa(
  supabase: SupabaseClient,
  mfaRequiredAfter: Date,
  now: Date = new Date()
): Promise<StaffMfaState> {
  if (!(await isFeatureEnabled(STAFF_MFA_FLAG))) {
    return { status: "not_enforced" };
  }

  const inGrace = now.getTime() < mfaRequiredAfter.getTime();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) {
    return inGrace
      ? { status: "grace", graceEndsAt: mfaRequiredAfter }
      : { status: "required", hasFactor: false };
  }

  if (data.currentLevel === "aal2") {
    return {
      status: "verified",
      lastVerifiedAt: lastSecondFactorAt(data.currentAuthenticationMethods),
    };
  }
  if (data.nextLevel === "aal2") {
    return { status: "required", hasFactor: true };
  }
  return inGrace
    ? { status: "grace", graceEndsAt: mfaRequiredAfter }
    : { status: "required", hasFactor: false };
}

/**
 * Whether a sensitive action (role grants, KYC overrides, DSAR exports) may
 * proceed: the second factor must have been verified within the step-up
 * window. The grace period does not apply to these actions.
 */
export function hasRecentSecondFactor(state: StaffMfaState, now: Date = new Date()): boolean {
  if (state.status === "not_enforced") return true;
  if (state.status !== "verified" || !state.lastVerifiedAt) return false;
  return now.getTime() - state.lastVerifiedAt.getTime() <= STEP_UP_WINDOW_MS;
}
