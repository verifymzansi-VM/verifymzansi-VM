import { isProductionDataEnvironment } from "@/lib/config/security-environment";
import type { AMREntry, SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

/** Feature flag that turns staff MFA enforcement on (kill switch when off). */
export const STAFF_MFA_FLAG = "staff_mfa_enforced";

/** Sensitive actions need a second factor verified within this window. */
export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

/** Any staff access needs an authenticator code verified within this window. */
export const STAFF_SESSION_MFA_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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

// Staff use an authenticator app. A session raised to AAL2 by any other factor
// type (SMS, WebAuthn) does not count, matching the database staff check.
const SECOND_FACTOR_METHODS = new Set(["totp", "mfa/totp"]);

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
 * `isFeatureEnabled` reports "off" both when the flag is off and when it could
 * not be read. The kill switch only counts when the flag row is readable and
 * explicitly off; a failed read keeps enforcement on (fail closed).
 */
async function mfaSwitchedOff(): Promise<boolean> {
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { data, error } = await createAdminClient()
      .from("feature_flags")
      .select("enabled, mode")
      .eq("key", STAFF_MFA_FLAG)
      .maybeSingle();
    if (error || !data) return false;
    const mode = (data as { mode?: string | null }).mode;
    return mode ? mode === "off" : !(data as { enabled: boolean }).enabled;
  } catch {
    return false;
  }
}

/**
 * Decide whether a staff session satisfies the MFA policy.
 *
 * - Enrolled but not verified this session, or the last authenticator code is
 *   older than 12 hours → required (verify now).
 * - Not enrolled → allowed until `mfaRequiredAfter`, then required.
 * - If the assurance level cannot be read, the grace period still applies but
 *   nothing is treated as verified (fail closed).
 */
export async function evaluateStaffMfa(
  supabase: SupabaseClient,
  mfaRequiredAfter: Date,
  now: Date = new Date()
): Promise<StaffMfaState> {
  // Deployed environments must verify a second factor before privileged access.
  // Enrolment remains available through requireStaff({ allowPendingMfa: true }).
  const strictMfa = isProductionDataEnvironment();
  const enforcementOff =
    !strictMfa && !(await isFeatureEnabled(STAFF_MFA_FLAG)) && (await mfaSwitchedOff());

  const inGrace = !strictMfa && now.getTime() < mfaRequiredAfter.getTime();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) {
    if (enforcementOff) return { status: "not_enforced" };
    return inGrace
      ? { status: "grace", graceEndsAt: mfaRequiredAfter }
      : { status: "required", hasFactor: false };
  }

  const lastVerifiedAt =
    data.currentLevel === "aal2" ? lastSecondFactorAt(data.currentAuthenticationMethods) : null;
  if (lastVerifiedAt) {
    const ageMs = now.getTime() - lastVerifiedAt.getTime();
    if (ageMs <= STAFF_SESSION_MFA_MAX_AGE_MS) return { status: "verified", lastVerifiedAt };
  }
  // Disabling routine enforcement must not hide a verified factor from the
  // sensitive-action guard, or make fresh verification impossible to satisfy.
  if (enforcementOff) return { status: "not_enforced" };
  // An AAL2 session without a recent authenticator code verifies again.
  if (data.currentLevel === "aal2") return { status: "required", hasFactor: true };
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
  if (state.status !== "verified" || !state.lastVerifiedAt) return false;
  const ageMs = now.getTime() - state.lastVerifiedAt.getTime();
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= STEP_UP_WINDOW_MS;
}
