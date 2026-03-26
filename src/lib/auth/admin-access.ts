import type { User } from "@supabase/supabase-js";
import { asStaffRole, getRoleFromUser, hasCapability, type Capability } from "@/lib/auth/roles";
import type { StaffRole } from "@/types/enums";

type MaybeUser = Pick<User, "app_metadata" | "is_anonymous"> | null | undefined;
type MaybeUserWithId = Pick<User, "id" | "app_metadata" | "is_anonymous"> | null | undefined;

/** Get the staff role from JWT (any of the three staff roles). */
export function getStaffActorRole(user: MaybeUser): StaffRole | null {
  return asStaffRole(getRoleFromUser(user));
}

/** Get the governance controller role from JWT. */
export function getGovernanceActorRole(user: MaybeUser): "governance_controller" | null {
  return getRoleFromUser(user) === "governance_controller" ? "governance_controller" : null;
}

/** Get the admin role from JWT. */
export function getAdminActorRole(user: MaybeUser): "admin" | null {
  return getRoleFromUser(user) === "admin" ? "admin" : null;
}

/**
 * Re-verify the staff role against the database to guard against stale JWTs.
 * Uses the Supabase Auth Admin API (`getUserById`) to read the current
 * `app_metadata.role` from the DB rather than trusting the token.
 */
export async function verifyStaffActorRoleFromDb(user: MaybeUserWithId): Promise<StaffRole | null> {
  const jwtRole = getStaffActorRole(user);
  if (!jwtRole || !user) return null;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(user.id);
  if (error || !data?.user) return null;

  return asStaffRole(getRoleFromUser(data.user));
}

/**
 * Re-verify the governance controller role against the database.
 */
export async function verifyGovernanceActorRoleFromDb(
  user: MaybeUserWithId
): Promise<"governance_controller" | null> {
  const role = await verifyStaffActorRoleFromDb(user);
  return role === "governance_controller" ? "governance_controller" : null;
}

/**
 * Re-verify the admin-only role against the database.
 */
export async function verifyAdminActorRoleFromDb(user: MaybeUserWithId): Promise<"admin" | null> {
  const role = await verifyStaffActorRoleFromDb(user);
  return role === "admin" ? "admin" : null;
}

/**
 * Verify that the user holds a specific capability with DB re-verification.
 * This is the gold-standard check for sensitive actions.
 */
export async function verifyCapabilityFromDb(
  user: MaybeUserWithId,
  capability: Capability
): Promise<boolean> {
  if (!user) return false;

  // First check JWT for fast rejection
  if (!hasCapability(user, capability)) return false;

  // Re-verify role from DB
  const dbRole = await verifyStaffActorRoleFromDb(user);
  if (!dbRole) return false;

  // Build a synthetic user-like object with the DB-verified role
  const dbUser = {
    app_metadata: { role: dbRole },
    is_anonymous: false,
  };
  return hasCapability(dbUser, capability);
}
