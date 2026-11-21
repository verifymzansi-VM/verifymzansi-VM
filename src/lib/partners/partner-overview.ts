/**
 * What the partner page shows, worked out from the partner's own summary
 * (api.my_partner_dashboard, read by readFoundationPartnerDashboard). Only
 * figures that summary holds; nothing is estimated.
 */

export interface PartnerDashboard {
  code: string;
  status: string;
  rateBps: number;
  referrals: number;
  payingReferrals: number;
  totals: Record<string, number>;
  recent: Array<{
    id: string;
    amountCents: number;
    baseCents: number;
    status: string;
    createdAt: string;
    eligibleAt: string;
    manual: boolean;
  }>;
}

/** The most commission rows the partner summary returns (newest first). */
export const PARTNER_RECENT_LIMIT = 50;

const monthKey = new Intl.DateTimeFormat("en-ZA", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Africa/Johannesburg",
});

/**
 * Commission earned in the current South African calendar month: every
 * commission created this month, including those still in their 30-day wait,
 * less reversed ones (a refund or chargeback reverses its commission).
 * `complete` is false when the summary's newest 50 rows are all from this
 * month, so older ones from this month may be missing.
 */
export function earnedThisMonth(recent: PartnerDashboard["recent"], now: Date) {
  const current = monthKey.format(now);
  const thisMonth = recent.filter((row) => monthKey.format(new Date(row.createdAt)) === current);
  const cents = thisMonth
    .filter((row) => row.status !== "REVERSED")
    .reduce((sum, row) => sum + row.amountCents, 0);
  const complete = recent.length < PARTNER_RECENT_LIMIT || thisMonth.length < recent.length;
  return { cents, complete };
}

/** Approved commission not yet paid: what the next payout holds. */
export function nextPayoutCents(totals: PartnerDashboard["totals"]) {
  return totals.APPROVED ?? 0;
}

/** The partner's referral link, as today's page shows it. */
export function partnerReferralLink(appUrl: string, code: string) {
  return `${appUrl}/?ref=${code}`;
}

/** Opens WhatsApp with the referral link as the message. */
export function whatsAppShareUrl(link: string) {
  return `https://wa.me/?text=${encodeURIComponent(link)}`;
}
