/**
 * Multi-listing packages (roadmap P4a, owner's decisions of 14 November 2026):
 * the rules the "Choose your package" checkout shows. The database applies
 * each of them again (api.start_package_checkout); these only decide what the
 * page offers and the total it shows.
 */

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

/**
 * The most slots that can be paid online for this term: at most 100, and a
 * total within the most Ozow accepts in one payment (`onlineMaxCents`, the
 * database's one setting, api.get_payment_limits). Unknown (null), only the
 * 100-slot rule applies here; the database still refuses above the limit.
 */
export function packageOnlineMaxSlots(days: PackageTerm, onlineMaxCents: number | null = null) {
  return onlineMaxCents === null
    ? PACKAGE_MAX_ONLINE_SLOTS
    : Math.min(PACKAGE_MAX_ONLINE_SLOTS, Math.floor(onlineMaxCents / packageTotalCents(1, days)));
}

export type PackageQuote =
  | { kind: "invalid" }
  | { kind: "too_small" }
  | { kind: "online"; totalCents: number }
  | { kind: "invoice"; totalCents: number }
  | { kind: "too_large" };

/** What the typed number buys: nothing below 5 or above 250, online up to
 * the term's online maximum, otherwise by invoice. */
export function packageQuote(
  slots: number | null,
  days: PackageTerm,
  onlineMaxCents: number | null = null
): PackageQuote {
  if (slots === null || !Number.isSafeInteger(slots) || slots < 1) return { kind: "invalid" };
  if (slots < PACKAGE_MIN_SLOTS) return { kind: "too_small" };
  if (slots > PACKAGE_MAX_SLOTS) return { kind: "too_large" };
  const totalCents = packageTotalCents(slots, days);
  return slots <= packageOnlineMaxSlots(days, onlineMaxCents)
    ? { kind: "online", totalCents }
    : { kind: "invoice", totalCents };
}

// ------------------------------------------------- adding slots part-way (P4b)

/** Slots are added online while this many whole days of the package are left. */
export const PACKAGE_ADD_MIN_DAYS = 7;
/** ...and by invoice while this many are left (D1: 7 days of use, 3 to pay). */
export const PACKAGE_ADD_MIN_INVOICE_DAYS = 10;

/** An added-slots invoice is due this many days after it is issued, or on the
 * package's last day when that is sooner (owner's decision of 20 November 2026). */
export const PACKAGE_ADD_INVOICE_DUE_DAYS = 3;

/** The South African date (YYYY-MM-DD) of an instant. */
const saDate = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });

/** The due date (YYYY-MM-DD) an added-slots invoice issued at `now` gets, as
 * the database sets it (internal.issue_package_customer_invoice). */
export function packageAddInvoiceDueOn(packageEndsAt: string, now: Date) {
  const issued = new Date(`${saDate(now)}T12:00:00+02:00`);
  issued.setUTCDate(issued.getUTCDate() + PACKAGE_ADD_INVOICE_DUE_DAYS);
  const due = saDate(issued);
  const last = saDate(new Date(packageEndsAt));
  return due < last ? due : last;
}

/** The add checkout's box; the database records it as package-add-starts-now-v1. */
export const PACKAGE_ADD_COOLING_OFF_CONSENT =
  "My added slots start now and end with my package; the 7-day cooling-off does not apply because the service starts immediately.";

export type PackageAddQuote =
  | { kind: "invalid" }
  | { kind: "too_large"; maxSlots: number }
  | { kind: "online"; totalCents: number }
  | { kind: "invoice"; totalCents: number }
  | { kind: "closed"; totalCents: number };

/**
 * What adding `slots` to a running package costs and how it is paid. The
 * database prices one added slot for the days left (`unitPriceCents`, R100 per
 * 30 days, rounded to the cent) and refuses any other total; an add of n slots
 * costs n times that. Online up to 100 slots in all and Ozow's maximum
 * (`onlineMaxCents`), otherwise by invoice; "closed" when that way is not open
 * any more (fewer than 7, or 10, days left).
 */
export function packageAddQuote(
  slots: number | null,
  offer: {
    unitPriceCents: number;
    places: number;
    maxSlots: number;
    onlineOpen: boolean;
    invoiceOpen: boolean;
  },
  onlineMaxCents: number | null
): PackageAddQuote {
  if (slots === null || !Number.isSafeInteger(slots) || slots < 1) return { kind: "invalid" };
  if (slots > offer.maxSlots) return { kind: "too_large", maxSlots: offer.maxSlots };
  const totalCents = offer.unitPriceCents * slots;
  const online =
    offer.places + slots <= PACKAGE_MAX_ONLINE_SLOTS &&
    (onlineMaxCents === null || totalCents <= onlineMaxCents);
  if (online)
    return offer.onlineOpen ? { kind: "online", totalCents } : { kind: "closed", totalCents };
  return offer.invoiceOpen ? { kind: "invoice", totalCents } : { kind: "closed", totalCents };
}

/** Reads the typed box: whole numbers only (empty or anything else is null). */
export function parseSlotCount(value: string): number | null {
  const text = value.trim();
  if (!/^[0-9]{1,4}$/.test(text)) return null;
  return Number(text);
}
