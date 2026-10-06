/**
 * Public view of a business's verification columns. Server code applies this
 * before a business record reaches any page or client component, so expired
 * stickers never show and a registered office's street lines stay private
 * unless the owner chose to show them.
 */

/** Columns added by 20261006124457_business_verifications.sql. */
export const BUSINESS_VERIFICATION_COLUMNS =
  "cipc_verified_at, cipc_expires_at, cipc_registration_number, cipc_registered_name, cipc_registered_office, show_full_registered_office, seen_verified_at, seen_expires_at, seen_method, seen_city, owner_verified_role, owner_position_title";

export type RegisteredOfficeView = {
  streetLines?: string[];
  suburb?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
};

/**
 * The registered office as the public may see it: suburb, city and province,
 * plus street lines and postal code only when the owner chose to show them.
 * This is all that is ever stored on `businesses` (anyone can read live
 * business rows); the full office stays on the staff-only case.
 */
export function publicOffice(
  office: RegisteredOfficeView | null | undefined,
  showFull: boolean
): RegisteredOfficeView | null {
  if (!office) return null;
  const base = {
    suburb: office.suburb ?? null,
    city: office.city ?? null,
    province: office.province ?? null,
  };
  return showFull
    ? { streetLines: office.streetLines ?? [], ...base, postalCode: office.postalCode ?? null }
    : base;
}

// Fail closed: every granted sticker has an expiry, so a row without one
// (or a select that forgot the column) shows no sticker.
const live = (verifiedAt: unknown, expiresAt: unknown, now: number) =>
  typeof verifiedAt === "string" && typeof expiresAt === "string" && Date.parse(expiresAt) > now;

const CIPC_FIELDS = [
  "cipc_verified_at",
  "cipc_expires_at",
  "cipc_registration_number",
  "cipc_registered_name",
  "cipc_registered_office",
  "owner_verified_role",
  "owner_position_title",
] as const;
const SEEN_FIELDS = ["seen_verified_at", "seen_expires_at", "seen_method", "seen_city"] as const;

export function toPublicVerification<T extends object>(row: T, now = Date.now()): T {
  if (!("cipc_verified_at" in row) && !("seen_verified_at" in row)) {
    // An office without its sticker state can't be shown safely.
    return "cipc_registered_office" in row ? { ...row, cipc_registered_office: null } : row;
  }
  const out: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  if (!live(out.cipc_verified_at, out.cipc_expires_at, now)) {
    for (const f of CIPC_FIELDS) out[f] = null;
  } else {
    out.cipc_registered_office = publicOffice(
      out.cipc_registered_office as RegisteredOfficeView | null,
      out.show_full_registered_office === true
    );
  }
  if (!live(out.seen_verified_at, out.seen_expires_at, now)) {
    for (const f of SEEN_FIELDS) out[f] = null;
  }
  return out as T;
}

/** One line for the profile: street (if shown), suburb, city, province, postal code. */
export function registeredOfficeLine(
  office: RegisteredOfficeView | null | undefined
): string | null {
  if (!office) return null;
  const parts = [
    ...(office.streetLines ?? []),
    office.suburb,
    office.city,
    office.province,
    office.postalCode,
  ];
  const line = parts
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(", ");
  return line || null;
}

/** Trust level 3 ("ID Reviewed") and above means the ID and selfie were reviewed. */
export const ID_REVIEWED_TRUST_LEVEL = 3;

export type BusinessStickerState = {
  idReviewed: boolean;
  cipcCheckedAt?: string | null;
  seenAt?: string | null;
  seenMethod?: "visit" | "video" | string | null;
  seenCity?: string | null;
};

/** Sticker columns business cards need (no registered office or position). */
export const CARD_STICKER_COLUMNS =
  "cipc_verified_at, cipc_expires_at, seen_verified_at, seen_expires_at, seen_method, seen_city";
