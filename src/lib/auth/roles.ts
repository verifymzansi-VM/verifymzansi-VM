import type { User } from "@supabase/supabase-js";
import { normalizeUserRole } from "@/lib/account/compat";
import type { StaffRole } from "@/types/enums";

type MaybeUser = Pick<User, "app_metadata" | "is_anonymous"> | null | undefined;

/* ── Capability Model ──────────────────────────────────────
   Each back-office action is a named capability.
   Roles are mapped to the capabilities they are allowed to exercise.
   All authorization checks go through `hasCapability()`.

   Role hierarchy (each level includes all lower capabilities):
     1. Admin          — full platform access (super-role)
     2. Governance Ctrl — decisions, oversight, appeals, enforcement
     3. Moderator       — queues, cases, verification
   ────────────────────────────────────────────────────────── */

export type Capability =
  // Moderator operations
  | "queue:view"
  | "queue:claim"
  | "case:view"
  | "case:recommend"
  | "case:escalate"
  | "case:add_note"
  // Governance controller decisions
  | "decision:approve"
  | "decision:reject"
  | "decision:override"
  | "decision:reopen"
  | "appeal:review"
  | "appeal:decide"
  | "enforcement:execute"
  | "role:assign"
  | "role:revoke"
  | "oversight:view"
  // Admin intelligence (read-only)
  | "bi:view"
  | "bi:export"
  | "bi:drill_down"
  // Cross-role
  | "audit:view"
  | "feature_flag:toggle"
  | "dsar:manage";

const ROLE_CAPABILITIES: Record<StaffRole, ReadonlySet<Capability>> = {
  /* 3rd — Moderator: queue & case operations */
  moderator: new Set<Capability>([
    "queue:view",
    "queue:claim",
    "case:view",
    "case:recommend",
    "case:escalate",
    "case:add_note",
  ]),
  /* 2nd — Governance Controller: decisions, oversight, appeals, enforcement */
  governance_controller: new Set<Capability>([
    "queue:view",
    "case:view",
    "case:add_note",
    "decision:approve",
    "decision:reject",
    "decision:override",
    "decision:reopen",
    "appeal:review",
    "appeal:decide",
    "enforcement:execute",
    "oversight:view",
    "audit:view",
    "dsar:manage",
  ]),
  /* 1st — Admin: super-role — ALL platform capabilities */
  admin: new Set<Capability>([
    // Moderator operations
    "queue:view",
    "queue:claim",
    "case:view",
    "case:recommend",
    "case:escalate",
    "case:add_note",
    // Governance controller decisions
    "decision:approve",
    "decision:reject",
    "decision:override",
    "decision:reopen",
    "appeal:review",
    "appeal:decide",
    "enforcement:execute",
    "oversight:view",
    "dsar:manage",
    // Admin-exclusive: role management
    "role:assign",
    "role:revoke",
    // Admin-exclusive: intelligence & tools
    "bi:view",
    "bi:export",
    "bi:drill_down",
    "audit:view",
    "feature_flag:toggle",
  ]),
};

/* ── Admin Email Allowlist ─────────────────────────────────
   Hard cap: only these accounts can ever hold the admin role.
   The hardcoded list serves as the bootstrap default. Set the
   ADMIN_EMAIL_ALLOWLIST env var (comma-separated) to override
   without redeploying code.
   ────────────────────────────────────────────────────────── */

const DEFAULT_ADMIN_EMAILS: ReadonlyArray<string> = Object.freeze([
  "ivelosm@gmail.com",
  "senzonsm@gmail.com",
]);

function loadAdminAllowlist(): ReadonlyArray<string> {
  const envList = typeof process !== "undefined" ? (process.env?.ADMIN_EMAIL_ALLOWLIST ?? "") : "";
  if (envList.trim()) {
    return Object.freeze(
      envList
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    );
  }
  return DEFAULT_ADMIN_EMAILS;
}

export const ADMIN_EMAIL_ALLOWLIST: ReadonlyArray<string> = loadAdminAllowlist();

/** Check whether an email is on the hardcoded admin allowlist (case-insensitive). */
export function isAllowedAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  return ADMIN_EMAIL_ALLOWLIST.includes(normalized);
}

/* ── Role Extraction ──────────────────────────────────────── */

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

/** Check whether the given user has the `governance_controller` role. */
export function isGovernanceController(user: MaybeUser): boolean {
  return getRoleFromUser(user) === "governance_controller";
}

/** Check whether the user holds any staff role (moderator, governance_controller, or admin). */
export function isStaff(user: MaybeUser): boolean {
  const role = getRoleFromUser(user);
  return role === "admin" || role === "moderator" || role === "governance_controller";
}

/**
 * @deprecated Use `isStaff()` or capability checks instead.
 * Kept for backward compatibility during migration.
 */
export function isModeratorOrAdmin(user: MaybeUser): boolean {
  return isStaff(user);
}

/** Narrow a role string to a staff role union type, or null. */
export function asStaffRole(role: string | null): StaffRole | null {
  if (role === "admin" || role === "moderator" || role === "governance_controller") return role;
  return null;
}

/**
 * Check whether a user has a specific capability.
 * This is the primary authorization check for the back-office.
 */
export function hasCapability(user: MaybeUser, capability: Capability): boolean {
  const role = getRoleFromUser(user);
  const staffRole = asStaffRole(role);
  if (!staffRole) return false;
  return ROLE_CAPABILITIES[staffRole].has(capability);
}

/**
 * Check whether a user has ALL of the listed capabilities.
 */
export function hasAllCapabilities(user: MaybeUser, capabilities: readonly Capability[]): boolean {
  return capabilities.every((cap) => hasCapability(user, cap));
}

/**
 * Check whether a user has ANY of the listed capabilities.
 */
export function hasAnyCapability(user: MaybeUser, capabilities: readonly Capability[]): boolean {
  return capabilities.some((cap) => hasCapability(user, cap));
}

/**
 * Return the full set of capabilities for a role.
 */
export function getCapabilitiesForRole(role: StaffRole): ReadonlySet<Capability> {
  return ROLE_CAPABILITIES[role];
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
