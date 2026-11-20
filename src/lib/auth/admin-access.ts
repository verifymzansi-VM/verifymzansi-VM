import type { User } from "@supabase/supabase-js";
import { asStaffRole, getRoleFromUser, hasCapability, type Capability } from "@/lib/auth/roles";
import { nativeCapabilityFor } from "@/lib/auth/native-capabilities";
import { readFoundationAccountContext } from "@/lib/foundation/account-context";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import type { StaffRole } from "@/types/enums";

type MaybeUser = Pick<User, "app_metadata" | "is_anonymous"> | null | undefined;

/**
 * Staff authority lives in the live backend's staff roles and capabilities,
 * read through the caller's own account context (api.get_my_account_context).
 * The JWT role in `app_metadata` is only a UI hint: nothing in this module
 * authorises from it.
 */
export interface StaffAccess {
  role: StaffRole;
  /** The canonical capabilities the database assigns to this role. */
  capabilities: readonly string[];
  /**
   * The database's staff check (internal.staff_actor) passes for this session
   * now: live session raised with a second factor, active account, verified
   * authenticator app, authenticator code within the last 12 hours.
   */
  canAccess: boolean;
  /** The account has a verified authenticator app. */
  totpEnrolled: boolean;
}

/** Which staff a request needs: any staff, administrators only, or a capability. */
export interface StaffRequirement {
  adminOnly?: boolean;
  capability?: Capability;
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
 * Read the caller's current staff access from the database, using the
 * caller's own verified session. Returns null for non-staff, revoked staff,
 * suspended or closed accounts, an owner invitation that has not been
 * accepted yet, and on any error (fail closed).
 */
export async function readStaffAccessFromDb(
  api: FoundationAuthenticatedApi
): Promise<StaffAccess | null> {
  try {
    const account = await readFoundationAccountContext(api);
    const staff = account.staff;
    // An unaccepted owner invitation shows the admin role as a setup hint
    // with no capabilities; it carries no authority.
    if (!staff || staff.assigned_capabilities.length === 0) return null;
    const role = asStaffRole(staff.role === "governor" ? "governance_controller" : staff.role);
    if (!role) return null;
    return {
      role,
      capabilities: staff.assigned_capabilities,
      canAccess: staff.can_access,
      totpEnrolled: account.totp_enrolled,
    };
  } catch {
    return null;
  }
}

/** Whether staff access includes a capability, by the database's assignment. */
export function staffAccessHasCapability(access: StaffAccess, capability: Capability): boolean {
  return access.capabilities.includes(nativeCapabilityFor(capability));
}

/** The staff role that meets `requirement`, or null. */
export function staffRoleMeeting(
  access: StaffAccess | null,
  { adminOnly = false, capability }: StaffRequirement = {}
): StaffRole | null {
  if (!access) return null;
  if (adminOnly && access.role !== "admin") return null;
  if (capability && !staffAccessHasCapability(access, capability)) return null;
  return access.role;
}

/** Current staff role from the database, or null. */
export async function verifyStaffActorRoleFromDb(
  api: FoundationAuthenticatedApi
): Promise<StaffRole | null> {
  return staffRoleMeeting(await readStaffAccessFromDb(api));
}

/**
 * Re-verify the governance controller role against the database.
 */
export async function verifyGovernanceActorRoleFromDb(
  api: FoundationAuthenticatedApi
): Promise<"governance_controller" | null> {
  const role = await verifyStaffActorRoleFromDb(api);
  return role === "governance_controller" ? "governance_controller" : null;
}

/**
 * Re-verify the admin-only role against the database.
 */
export async function verifyAdminActorRoleFromDb(
  api: FoundationAuthenticatedApi
): Promise<"admin" | null> {
  const role = staffRoleMeeting(await readStaffAccessFromDb(api), { adminOnly: true });
  return role === "admin" ? "admin" : null;
}

/** Whether a staff role grants a capability (the preserved back-office map). */
export function roleHasCapability(role: StaffRole, capability: Capability): boolean {
  return hasCapability({ app_metadata: { role }, is_anonymous: false }, capability);
}

/**
 * Verify that the caller holds a specific capability according to the database.
 */
export async function verifyCapabilityFromDb(
  api: FoundationAuthenticatedApi,
  capability: Capability
): Promise<boolean> {
  return (await verifyCapabilityRoleFromDb(api, capability)) !== null;
}

/**
 * Verify that the caller holds a specific capability according to the
 * database, returning the DB-verified role for audit logs and decision records.
 */
export async function verifyCapabilityRoleFromDb(
  api: FoundationAuthenticatedApi,
  capability: Capability
): Promise<StaffRole | null> {
  return staffRoleMeeting(await readStaffAccessFromDb(api), { capability });
}
