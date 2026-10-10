import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasActiveStaffSession } from "@/lib/auth/staff-session";
import { readStaffAccessFromDb } from "@/lib/auth/admin-access";
import { evaluateStaffMfa, hasRecentSecondFactor, STAFF_MFA_PATH } from "@/lib/auth/staff-mfa";

/**
 * Enforce the staff MFA policy on a back-office API request, after the
 * caller's staff role has been verified. Returns a 403 response to send, or
 * null when the request may proceed.
 *
 * `stepUp` marks sensitive actions (role changes, high-risk KYC overrides,
 * DSAR exports) that need a second factor verified in the last 15 minutes,
 * even during the enrolment grace period.
 */
export async function checkStaffApiMfa(
  supabase: SupabaseClient,
  userId: string,
  { stepUp = false }: { stepUp?: boolean } = {}
): Promise<NextResponse | null> {
  const access = await readStaffAccessFromDb(userId);
  if (!access || !(await hasActiveStaffSession(supabase, userId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const mfa = await evaluateStaffMfa(supabase, access.mfaRequiredAfter);
  if (mfa.status === "required") {
    return NextResponse.json(
      {
        error: "Verify with your authenticator app to continue.",
        code: "mfa_required",
        verifyUrl: STAFF_MFA_PATH,
      },
      { status: 403 }
    );
  }
  if (stepUp && !hasRecentSecondFactor(mfa)) {
    return NextResponse.json(
      {
        error: "Confirm it's you with your authenticator app, then try again.",
        code: "step_up_required",
        verifyUrl: `${STAFF_MFA_PATH}?confirm=1`,
      },
      { status: 403 }
    );
  }
  return null;
}
