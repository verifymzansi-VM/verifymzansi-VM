import type { FoundationAccountContext } from "@/lib/foundation/account-context";

/**
 * Name to show the signed-in person in their own header. It is presentation
 * only: it never reaches another person and never grants anything.
 *
 * Google sign-in fills `full_name` / `name` (and `given_name` / `family_name`)
 * rather than `display_name`, so all of them are read before falling back to
 * the address's local part.
 */
export function readSessionDisplayName(userMetadata: unknown, email: string | undefined): string {
  const metadata =
    userMetadata && typeof userMetadata === "object"
      ? (userMetadata as Record<string, unknown>)
      : null;

  const readName = (...keys: string[]) => {
    for (const key of keys) {
      const value = metadata?.[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return "";
  };

  const directName = readName("display_name", "full_name", "name");
  if (directName) {
    return directName;
  }

  const combinedName = [readName("given_name"), readName("family_name")]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (combinedName) {
    return combinedName;
  }

  return email?.split("@")[0] || "User";
}

/**
 * Header name for the foundation backend: the saved profile name wins; until
 * the person saves one, the sign-in provider's name (or the address) is used
 * so the avatar never falls back to a bare "U".
 */
export function foundationSessionDisplayName(
  profileDisplayName: string | null | undefined,
  userMetadata: unknown,
  email: string | undefined
): string {
  const saved = profileDisplayName?.trim();
  return saved ? saved : readSessionDisplayName(userMetadata, email);
}

/**
 * Navigation role for the foundation backend. Staff keep their role even
 * before this session's two-step check, so the header can lead them to the
 * back office, which sends them to the two-step page first. The server
 * re-checks role, account and two-step on every staff page and command.
 */
export function foundationSessionRole(staff: FoundationAccountContext["staff"]): string {
  if (!staff) return "user";
  return staff.role === "governor" ? "governance_controller" : staff.role;
}

const STAFF_ROLES = new Set(["moderator", "governance_controller", "admin"]);

export function isStaffRole(role: string | null | undefined): boolean {
  return typeof role === "string" && STAFF_ROLES.has(role);
}
