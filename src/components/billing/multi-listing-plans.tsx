import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import { BILLING_EMAIL } from "@/lib/billing/slot-checkout";
import {
  PACKAGE_MAX_ONLINE_SLOTS,
  PACKAGE_MIN_SLOTS,
  PACKAGE_POSTS_PER_SLOT_PER_30_DAYS,
  PACKAGE_QUICK_SIZES,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
  PACKAGE_TERMS,
  packageQuote,
  type PackageTerm,
} from "@/lib/billing/slot-packages";

const TERM_LABEL: Record<PackageTerm, string> = {
  30: "30 days",
  90: "90 days",
  180: "180 days",
};

/** The checkout with this size and term filled in (any number can be typed there). */
export function packageCheckoutHref(slots: number, days: PackageTerm) {
  return `/billing/package?slots=${slots}&days=${days}`;
}

/**
 * Multi-listing packages (roadmap P4a, the owner's decisions of 14 November
 * 2026): R100 per slot per 30 days, from 5 slots, for 30, 90 or 180 days. One
 * card per common size with the total for each term; any number from 5 can be
 * typed at checkout. Totals above Ozow's maximum for one payment (or above 100
 * slots) are paid by invoice at the same price. The maximum is known only for
 * a signed-in member (`onlineMaxCents`); otherwise the checkout says so.
 */
export function MultiListingPlans({
  headingLevel = "h3",
  onlineMaxCents = null,
}: {
  headingLevel?: "h2" | "h3";
  onlineMaxCents?: number | null;
}) {
  const Heading = headingLevel;
  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {PACKAGE_QUICK_SIZES.map((slots) => (
          <li
            key={slots}
            className="flex flex-col rounded-2xl border border-border/70 bg-card p-4 elev-xs"
          >
            <Heading className="font-display text-lg font-bold text-foreground">
              {slots} slots
            </Heading>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {`${slots} posts live at once · up to ${slots * PACKAGE_POSTS_PER_SLOT_PER_30_DAYS} new posts per 30 days`}
            </p>
            <ul className="mt-3 flex flex-1 flex-col gap-2">
              {PACKAGE_TERMS.map((days) => {
                const quote = packageQuote(slots, days, onlineMaxCents);
                if (quote.kind !== "online" && quote.kind !== "invoice") return null;
                const price = formatPlanPrice(quote.totalCents);
                return (
                  <li key={days} className="rounded-xl bg-muted/50 p-3">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {TERM_LABEL[days]}
                      </span>
                      <span className="font-display text-lg font-bold tabular-nums text-foreground">
                        {price}
                      </span>
                    </p>
                    {quote.kind === "online" ? (
                      <Button asChild variant="outline" className="mt-2 h-11 w-full rounded-full">
                        <Link
                          href={packageCheckoutHref(slots, days)}
                          aria-label={`Choose ${slots} slots for ${TERM_LABEL[days]}, ${price}`}
                        >
                          Choose {TERM_LABEL[days]}
                        </Link>
                      </Button>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">By invoice</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">
        {`${formatPlanPrice(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per slot per 30 days, from ${PACKAGE_MIN_SLOTS} slots; type any number at checkout. All slots end together. Prepaid; does not renew automatically. Refunds only where the law requires — see Terms. Every poster is ID reviewed and every post reviewed before it goes live. Paid online up to the most our payment provider, Ozow, accepts in one payment; more than that, or more than ${PACKAGE_MAX_ONLINE_SLOTS} slots, by invoice at the same price.`}{" "}
        <a
          href={`mailto:${BILLING_EMAIL}?subject=Invoice%20for%20a%20Multi-listing%20package`}
          className="font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
        >
          Ask for an invoice
        </a>
        .
      </p>
    </div>
  );
}
