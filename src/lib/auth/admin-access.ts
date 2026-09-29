import type { User } from "@supabase/supabase-js";
import { asStaffRole, getRoleFromUser, hasCapability, type Capability } from "@/lib/auth/roles";
import type { StaffRole } from "@/types/enums";

type MaybeUser = Pick<User, "app_metadata" | "is_anonymous"> | null | undefined;
type MaybeUserWithId = Pick<User, "id" | "app_metadata" | "is_anonymous"> | null | undefined;

/**
 * Staff authority lives in `public.staff_roles` (see the
 * 20260927110000_staff_roles_authority migration). The JWT role in
 * `app_metadata` is only a UI hint kept in sync after role changes: nothing
 * in this module authorises from it.
 */
export interface StaffAccess {
  role: StaffRole;
  /** Staff must have a verified second factor after this time. */
  mfaRequiredAfter: Date;
}

/** Get the staff role from JWT (a hint only — never use it to authorise). */
export function getStaffActorRole(user: MaybeUser): StaffRole | null {
  return asStaffRole(getRoleFromUser(user));
}

/** Get the governance controller role from JWT (a hint only). */
export function getGovernanceActorRole(user: MaybeUser): "governance_controller" | null {
  return getRoleFromUser(user) === "governance_controller" ? "governance_controller" : null;
}

/** Get the admin role from JWT (a hint only). */
export function getAdminActorRole(user: MaybeUser): "admin" | null {
  return getRoleFromUser(user) === "admin" ? "admin" : null;
}

/**
 * Read a user's current staff access from the database. Returns null for
 * non-staff, revoked staff, banned or suspended accounts, and on any error
 * (fail closed).
 */
export async function readStaffAccessFromDb(userId: string): Promise<StaffAccess | null> {
  let data: unknown;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const result = await createAdminClient().rpc("staff_access_of", { p_user: userId });
    if (result.error) return null;
    data = result.data;
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;

  const row = data[0] as { role?: unknown; mfa_required_after?: unknown };
  const role = asStaffRole(typeof row.role === "string" ? row.role : null);
  const mfaRequiredAfter =
    typeof row.mfa_required_after === "string" ? new Date(row.mfa_required_after) : null;
  if (!role || !mfaRequiredAfter || Number.isNaN(mfaRequiredAfter.getTime())) return null;

  return { role, mfaRequiredAfter };
}

/** Current staff role from the database, or null. */
export async function verifyStaffActorRoleFromDb(user: MaybeUserWithId): Promise<StaffRole | null> {
  if (!user || user.is_anonymous) return null;
  return (await readStaffAccessFromDb(user.id))?.role ?? null;
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

/** Whether a staff role grants a capability. */
export function roleHasCapability(role: StaffRole, capability: Capability): boolean {
  return hasCapability({ app_metadata: { role }, is_anonymous: false }, capability);
}

/**
 * Verify that the user holds a specific capability according to the database.
 */
export async function verifyCapabilityFromDb(
  user: MaybeUserWithId,
  capability: Capability
): Promise<boolean> {
  return (await verifyCapabilityRoleFromDb(user, capability)) !== null;
}

/**
 * Verify that the user holds a specific capability according to the database,
 * returning the DB-verified role for audit logs and decision records.
 */
export async function verifyCapabilityRoleFromDb(
  user: MaybeUserWithId,
  capability: Capability
): Promise<StaffRole | null> {
  const role = await verifyStaffActorRoleFromDb(user);
  return role && roleHasCapability(role, capability) ? role : null;
}
