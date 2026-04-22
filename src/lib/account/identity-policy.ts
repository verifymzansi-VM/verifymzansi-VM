/**
 * Identity & contact-change policy constants.
 *
 * Centralises every business rule that governs immutable identity fields
 * and contact-change cooldowns so that API routes, DB triggers, and the
 * settings UI all reference a single source of truth.
 */

/* ── Cooldown windows ─────────────────────────────────────── */

/** Minimum interval (ms) between successful phone changes. */
export const PHONE_CHANGE_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

/** Minimum interval (ms) between successful email changes. */
export const EMAIL_CHANGE_COOLDOWN_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

/** Cooldown in days (for display purposes). */
export const PHONE_CHANGE_COOLDOWN_DAYS = 15;
export const EMAIL_CHANGE_COOLDOWN_DAYS = 15;

/* ── Immutability rules ───────────────────────────────────── */

/* ── Policy error codes ───────────────────────────────────── */

export type IdentityPolicyCode =
  | "NAME_LOCKED"
  | "LOCATION_LOCKED"
  | "PHONE_COOLDOWN"
  | "PHONE_REVERIFICATION_REQUIRED"
  | "EMAIL_COOLDOWN"
  | "EMAIL_REVERIFICATION_REQUIRED";

export interface IdentityPolicyError {
  code: IdentityPolicyCode;
  message: string;
  /** ISO-8601 timestamp when the user becomes eligible to retry. */
  retryAfter?: string;
}

/* ── Error factories ──────────────────────────────────────── */

export function nameLocked(): IdentityPolicyError {
  return {
    code: "NAME_LOCKED",
    message:
      "Your display name has been set from your verified ID and cannot be changed. " +
      "Contact support if you believe this is an error.",
  };
}

export function locationLocked(): IdentityPolicyError {
  return {
    code: "LOCATION_LOCKED",
    message: "Your province and city were set during verification and cannot be changed.",
  };
}

export function phoneCooldown(nextEligibleAt: Date): IdentityPolicyError {
  return {
    code: "PHONE_COOLDOWN",
    message: `You can change your phone number again after ${nextEligibleAt.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}.`,
    retryAfter: nextEligibleAt.toISOString(),
  };
}

export function phoneReverificationRequired(): IdentityPolicyError {
  return {
    code: "PHONE_REVERIFICATION_REQUIRED",
    message: "You must complete identity re-verification before changing your phone number.",
  };
}

export function emailCooldown(nextEligibleAt: Date): IdentityPolicyError {
  return {
    code: "EMAIL_COOLDOWN",
    message: `You can change your email address again after ${nextEligibleAt.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}.`,
    retryAfter: nextEligibleAt.toISOString(),
  };
}

/* ── Cooldown helpers ─────────────────────────────────────── */

/**
 * Returns `null` if the cooldown has elapsed, or the next-eligible `Date`
 * if it has not.
 */
export function checkCooldown(
  lastChangeIso: string | null | undefined,
  cooldownMs: number
): Date | null {
  if (!lastChangeIso) return null;
  const lastChange = new Date(lastChangeIso).getTime();
  if (Number.isNaN(lastChange)) return null;
  const eligible = lastChange + cooldownMs;
  return Date.now() < eligible ? new Date(eligible) : null;
}
