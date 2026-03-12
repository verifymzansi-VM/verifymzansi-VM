import type { User } from "@supabase/supabase-js";
import { normalizeUserRole } from "@/lib/account/compat";

type MaybeUser = Pick<User, "app_metadata" | "is_anonymous"> | null | undefined;

function readRole(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const role = (metadata as Record<string, unknown>).role;
  if (typeof role !== "string") {
    return null;
  }

  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Extract the role string from a Supabase user's `app_metadata`.
 * Returns `null` for anonymous, missing, or invalid roles.
 */
export function getRoleFromUser(user: MaybeUser): string | null {
  if (!user || user.is_anonymous) {
    return null;
  }

  const rawRole = readRole(user.app_metadata);
  return normalizeUserRole(rawRole) ?? rawRole;
}

/** Check whether the given user has the `admin` role. */
export function isAdmin(user: MaybeUser): boolean {
  return getRoleFromUser(user) === "admin";
}

/** Check whether the given user has the `moderator` or `admin` role. */
export function isModeratorOrAdmin(user: MaybeUser): boolean {
  const role = getRoleFromUser(user);
  return role === "admin" || role === "moderator";
}

/** Narrow a role string to the admin/moderator union type, or null. */
export function asAdminRole(role: string | null): "admin" | "moderator" | null {
  if (role === "admin" || role === "moderator") return role;
  return null;
}

/**
 * Verify that the user's role is included in `allowedRoles`.
 * @param user - The Supabase user (or null/undefined).
 * @param allowedRoles - A readonly list of permitted role strings.
 * @returns `true` if the user holds one of the allowed roles.
 */
export function requireRole(user: MaybeUser, allowedRoles: ReadonlyArray<string>): boolean {
  const role = getRoleFromUser(user);
  if (!role) {
    return false;
  }

  return allowedRoles.includes(role);
}
