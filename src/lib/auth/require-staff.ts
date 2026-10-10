import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { hasActiveStaffSession } from "@/lib/auth/staff-session";
import { createClient } from "@/lib/supabase/server";
import type { Capability } from "@/lib/auth/roles";
import { readStaffAccessFromDb, roleHasCapability } from "@/lib/auth/admin-access";
import { evaluateStaffMfa, STAFF_MFA_PATH, type StaffMfaState } from "@/lib/auth/staff-mfa";
import type { StaffRole } from "@/types/enums";

export type StaffSession =
  | { status: "anonymous" }
  | { status: "not_staff"; user: User }
  | { status: "staff"; user: User; role: StaffRole; mfa: StaffMfaState };

/**
 * The current request's staff session, read once per request (the layout and
 * the page share it). Role and account status come from the database; the
 * JWT role is never trusted.
 */
const getStaffSession = cache(async (): Promise<StaffSession> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous || !(await hasActiveStaffSession(supabase, user.id)))
    return { status: "anonymous" };

  const access = await readStaffAccessFromDb(user.id);
  if (!access) return { status: "not_staff", user };

  const mfa = await evaluateStaffMfa(supabase, access.mfaRequiredAfter);
  return { status: "staff", user, role: access.role, mfa };
});

export type AuthorizedStaff = Extract<StaffSession, { status: "staff" }>;

/**
 * Guard for back-office pages. Redirects anyone who is not current staff,
 * staff whose role lacks `capability`, and staff who still need to complete
 * two-step verification.
 */
export async function requireStaff(
  capability?: Capability,
  options: { allowPendingMfa?: boolean } = {}
): Promise<AuthorizedStaff> {
  const session = await getStaffSession();
  if (session.status === "anonymous") redirect("/login");
  if (session.status === "not_staff") redirect("/dashboard");

  if (!options.allowPendingMfa && session.mfa.status === "required") {
    redirect(STAFF_MFA_PATH);
  }
  if (capability && !roleHasCapability(session.role, capability)) {
    redirect("/admin");
  }
  return session;
}
