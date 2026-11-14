/**
 * Multi-listing packages (roadmap P4a, owner's decisions of 14 November 2026):
 * the rules the "Choose your package" checkout shows. The database applies
 * each of them again (api.start_package_checkout); these only decide what the
 * page offers and the total it shows.
 */
import { ONLINE_ORDER_LIMIT_CENTS } from "./slot-checkout";

/** Packages start at 5 slots; 1 to 4 are Individual slots. */
export const PACKAGE_MIN_SLOTS = 5;
/** At most this many slots are bought online; more by invoice. */
export const PACKAGE_MAX_ONLINE_SLOTS = 100;
/** The most slots one business can hold for now (staff review capacity). */
export const PACKAGE_MAX_SLOTS = 250;
/** R100 per slot per 30 days. */
export const PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS = 10_000;
/** The package terms, 30 days preselected (refund policy rule 10). */
export const PACKAGE_TERMS = [30, 90, 180] as const;
export type PackageTerm = (typeof PACKAGE_TERMS)[number];
/** Shortcuts that fill the number box. */
export const PACKAGE_QUICK_SIZES = [5, 10, 25, 50, 100] as const;
/** Posts going live per slot per 30 days, counted across the whole package. */
export const PACKAGE_POSTS_PER_SLOT_PER_30_DAYS = 4;
/** Adding slots part-way is allowed while this many days are left (P4b). */
export const PACKAGE_ADD_SLOTS_MIN_DAYS_LEFT = 7;

/** The checkout box (ECT Act s42(2)); the database records it as
 * package-starts-now-v1. */
export const PACKAGE_COOLING_OFF_CONSENT =
  "My slots start now; the 7-day cooling-off does not apply because the service starts immediately.";

export function isPackageTerm(days: number): days is PackageTerm {
  return (PACKAGE_TERMS as readonly number[]).includes(days);
}

/** R100 x slots x (days / 30): always whole rands for a new package. */
export function packageTotalCents(slots: number, days: PackageTerm) {
  return PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS * slots * (days / 30);
}

/** The most slots that can be paid online for this term (R10,000 or less). */
export function packageOnlineMaxSlots(days: PackageTerm) {
  return Math.min(
    PACKAGE_MAX_ONLINE_SLOTS,
    Math.floor(ONLINE_ORDER_LIMIT_CENTS / packageTotalCents(1, days))
  );
}

export type PackageQuote =
  | { kind: "invalid" }
  | { kind: "too_small" }
  | { kind: "online"; totalCents: number }
  | { kind: "invoice"; totalCents: number }
  | { kind: "too_large" };

/** What the typed number buys: nothing below 5 or above 250, online up to
 * the term's online maximum, otherwise by invoice. */
export function packageQuote(slots: number | null, days: PackageTerm): PackageQuote {
  if (slots === null || !Number.isSafeInteger(slots) || slots < 1) return { kind: "invalid" };
  if (slots < PACKAGE_MIN_SLOTS) return { kind: "too_small" };
  if (slots > PACKAGE_MAX_SLOTS) return { kind: "too_large" };
  const totalCents = packageTotalCents(slots, days);
  return slots <= packageOnlineMaxSlots(days)
    ? { kind: "online", totalCents }
    : { kind: "invoice", totalCents };
}

/** Reads the typed box: whole numbers only (empty or anything else is null). */
export function parseSlotCount(value: string): number | null {
  const text = value.trim();
  if (!/^[0-9]{1,4}$/.test(text)) return null;
  return Number(text);
}

/** Team size included (owner's decision 9: the owner counts): you + 1 person,
 * you + 4 people from 50 slots. The team itself comes with P4c. */
export function packageTeamSize(slots: number) {
  return slots >= 50 ? 5 : 2;
}
