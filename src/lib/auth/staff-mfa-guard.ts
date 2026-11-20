import { NextResponse } from "next/server";
import type { StaffAccess } from "@/lib/auth/admin-access";
import { evaluateStaffMfa, hasRecentSecondFactor, STAFF_MFA_PATH } from "@/lib/auth/staff-mfa";
import { recordSecurityEvent } from "@/lib/security/security-events";

/**
 * Enforce the staff MFA policy on a back-office API request, after the
 * caller's staff role has been verified. `access` is the caller's staff
 * access read from the database for this request (null refuses), and
 * `authenticatorAt` the verified session's last authenticator time (seconds).
 * Returns a 403 response to send, or null when the request may proceed.
 *
 * `stepUp` marks sensitive actions (role changes, high-risk KYC overrides,
 * DSAR exports) that need a second factor verified in the last 15 minutes.
 */
export async function checkStaffApiMfa(
  {
    access,
    accountId,
    authenticatorAt,
  }: { access: StaffAccess | null; accountId: string; authenticatorAt: number | null },
  { stepUp = false }: { stepUp?: boolean } = {}
): Promise<NextResponse | null> {
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const mfa = evaluateStaffMfa({
    canAccess: access.canAccess,
    totpEnrolled: access.totpEnrolled,
    authenticatorAt,
  });
  if (mfa.status === "required") {
    recordSecurityEvent({
      event: "staff.second_factor_required",
      accountId,
      reason: "mfa_required",
    });
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
    recordSecurityEvent({
      event: "staff.second_factor_required",
      accountId,
      reason: "step_up_required",
    });
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
