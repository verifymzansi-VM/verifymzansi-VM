import type { User } from "@supabase/supabase-js";
import { getRoleFromUser } from "@/lib/auth/roles";

export interface SessionUserView {
  displayName: string;
  email: string;
  initials: string;
  role: string;
}

function readFirstNonEmptyString(input: unknown, keys: readonly string[]): string {
  if (!input || typeof input !== "object") {
    return "";
  }

  const data = input as Record<string, unknown>;

  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

export function deriveInitials(displayName: string, email: string): string {
  const trimmedName = displayName.trim();
  if (trimmedName.length > 0) {
    const initials = trimmedName
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2);

    if (initials.length > 0) {
      return initials;
    }
  }

  const trimmedEmail = email.trim();
  if (trimmedEmail.length > 0) {
    return trimmedEmail.slice(0, 2).toUpperCase();
  }

  return "U";
}

export function buildSessionUser(user: User | null | undefined): SessionUserView | null {
  if (!user || user.is_anonymous) {
    return null;
  }

  const metadataDisplayName = readFirstNonEmptyString(user.user_metadata, [
    "display_name",
    "full_name",
    "name",
  ]);
  const givenName = readFirstNonEmptyString(user.user_metadata, ["given_name"]);
  const familyName = readFirstNonEmptyString(user.user_metadata, ["family_name"]);
  const displayName =
    metadataDisplayName || [givenName, familyName].filter(Boolean).join(" ").trim();
  const role = getRoleFromUser(user) || "";
  const email = typeof user.email === "string" ? user.email : "";

  return {
    displayName,
    email,
    initials: deriveInitials(displayName, email),
    role,
  };
}
