import type { User } from "@supabase/supabase-js";
import { asAdminRole, getRoleFromUser } from "@/lib/auth/roles";

type MaybeUser = Pick<User, "app_metadata" | "is_anonymous"> | null | undefined;
type MaybeUserWithId = Pick<User, "id" | "app_metadata" | "is_anonymous"> | null | undefined;

export function getStaffActorRole(user: MaybeUser): "admin" | "moderator" | null {
  return asAdminRole(getRoleFromUser(user));
}

export function getAdminActorRole(user: MaybeUser): "admin" | null {
  return getRoleFromUser(user) === "admin" ? "admin" : null;
}

/**
 * Re-verify the staff role against the database to guard against stale JWTs.
 * Uses the Supabase Auth Admin API (`getUserById`) to read the current
 * `app_metadata.role` from the DB rather than trusting the token.
 */
export async function verifyStaffActorRoleFromDb(
  user: MaybeUserWithId
): Promise<"admin" | "moderator" | null> {
  const jwtRole = getStaffActorRole(user);
  if (!jwtRole || !user) return null;

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(user.id);
  if (error || !data?.user) return null;

  return asAdminRole(getRoleFromUser(data.user));
}

/**
 * Re-verify the admin-only role against the database.
 */
export async function verifyAdminActorRoleFromDb(user: MaybeUserWithId): Promise<"admin" | null> {
  const role = await verifyStaffActorRoleFromDb(user);
  return role === "admin" ? "admin" : null;
}
