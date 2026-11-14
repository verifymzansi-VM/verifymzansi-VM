/**
 * Individual slots (posting terms posting-v4, Pricing v2 P2): the rules the
 * checkout shows. The database applies each of them again
 * (api.start_slot_checkout); these only decide what the page offers.
 */

/** Orders of R10,000 or less are paid online; more is paid by invoice. */
export const ONLINE_ORDER_LIMIT_CENTS = 1_000_000;

/** Where members ask for an invoice (and send cancellation requests). */
export const BILLING_EMAIL = "billing@verifymzansi.com";

/** The checkout box posting-v4 requires before payment (ECT Act s42(2)). */
export const COOLING_OFF_CONSENT =
  "My slot starts now; the 7-day cooling-off does not apply because the service starts immediately.";

/** Posts going live per paid slot per 30 days (posting-v4 fair use). */
export const POSTS_PER_SLOT_PER_30_DAYS = 4;

/**
 * Renewing (roadmap P3, owner's rule of 14 November 2026): a slot can be
 * renewed from this many days before it ends. The database's one setting is
 * internal.slot_renewal_window(); keep the two equal.
 */
export const RENEWAL_WINDOW_DAYS = 14;

/**
 * The renewal's own checkout box. Never the new-slot wording above: renewed
 * days start on a later date, and cancelling before they start means a full
 * refund. The database records the version renewal-cooling-off-v1 with each
 * slot's start date. Wording awaiting the owner's approval (lawyer later).
 */
export function renewalConsent(startDates: readonly string[]): string {
  return startDates.length === 1
    ? `My new days start on ${startDates[0]}, when my current days end. If I cancel before they start, I get a full refund; once they start, the 7-day cooling-off no longer applies.`
    : "My new days for each slot start when its current days end (dates above). If I cancel before they start, I get a full refund; once they start, the 7-day cooling-off no longer applies.";
}

/** One term of the Individual slot on sale. */
export interface SlotCheckoutTerm {
  planId: string;
  label: string;
  durationDays: number;
  /** Price of one slot for the whole term, in cents. */
  priceCents: number;
}

/** The member's Individual slots, from api.get_my_slots. */
export interface SlotCheckoutStatus {
  verified: boolean;
  held: number;
  /** Slots in payments still open at Ozow. */
  pending: number;
  limit: number;
}

/** Slot price x slots: the term's price already covers its 30-day periods. */
export function slotOrderTotalCents(term: Pick<SlotCheckoutTerm, "priceCents">, slots: number) {
  return term.priceCents * slots;
}

/** How many more Individual slots the member can buy now (null: unknown). */
export function slotsAvailable(status: SlotCheckoutStatus | null | undefined): number | null {
  if (!status) return null;
  return Math.max(0, status.limit - status.held - status.pending);
}
