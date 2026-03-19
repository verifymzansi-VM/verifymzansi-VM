import type { User } from "@supabase/supabase-js";
import { asAdminRole, getRoleFromUser } from "@/lib/auth/roles";

type MaybeUser = Pick<User, "app_metadata" | "is_anonymous"> | null | undefined;

export function getStaffActorRole(user: MaybeUser): "admin" | "moderator" | null {
  return asAdminRole(getRoleFromUser(user));
}

export function getAdminActorRole(user: MaybeUser): "admin" | null {
  return getRoleFromUser(user) === "admin" ? "admin" : null;
}
