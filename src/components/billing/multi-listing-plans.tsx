import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ENTERPRISE_ADMINS_INCLUDED,
  ENTERPRISE_QUOTE_ABOVE_SLOTS,
  formatPlanPrice,
} from "@/lib/constants/pricing";
import type { EnterpriseCatalogPlan } from "@/lib/commercial/plans";

const MULTI_LISTING_QUOTE_HREF = "/contact?topic=organisation_proposal";

const TERMS = [
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
] as const;

/** Price of one live post for 30 days, so plans compare with the R50 single post. */
export function perPostPer30DaysCents(
  plan: Pick<EnterpriseCatalogPlan, "priceCents" | "slots" | "durationDays">
) {
  return Math.round((plan.priceCents * 30) / plan.durationDays / plan.slots);
}

/**
 * Multi-listing plans you can buy directly: one card per size with a Choose
 * button per term that opens checkout. When online checkout is switched off
 * (commercial setting `enterpriseCheckout`), prices stay visible and the quote
 * link is the way to buy.
 */
export function MultiListingPlans({
  plans,
  checkoutEnabled,
  headingLevel = "h3",
}: {
  plans: EnterpriseCatalogPlan[];
  checkoutEnabled: boolean;
  headingLevel?: "h2" | "h3";
}) {
  const sizes = [...new Set(plans.map((plan) => plan.slots))].sort((a, b) => a - b);
  const priceFor = (slots: number, days: number) =>
    plans.find((plan) => plan.slots === slots && plan.durationDays === days);
  const Heading = headingLevel;

  if (sizes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Multi-listing plans are being updated.{" "}
        <Link href={MULTI_LISTING_QUOTE_HREF} className="font-semibold underline">
          Ask us for a quote
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sizes.map((slots) => {
          const swaps = priceFor(slots, TERMS[0].days)?.monthlyActivations;
          return (
            <li
              key={slots}
              className="flex flex-col rounded-2xl border border-border/70 bg-card p-4 elev-xs"
            >
              <Heading className="font-display text-lg font-bold text-foreground">
                {slots} live posts
              </Heading>
              <p className="mt-0.5 text-xs text-muted-foreground">
                At the same time, in any section
                {swaps ? ` · up to ${swaps} new posts per 30 days` : ""}
              </p>
              <ul className="mt-3 flex flex-1 flex-col gap-2">
                {TERMS.map((term) => {
                  const plan = priceFor(slots, term.days);
                  if (!plan) return null;
                  const price = formatPlanPrice(plan.priceCents);
                  return (
                    <li key={term.days} className="rounded-xl bg-muted/50 p-3">
                      <p className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{term.label}</span>
                        <span className="font-display text-lg font-bold tabular-nums text-foreground">
                          {price}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatPlanPrice(perPostPer30DaysCents(plan))} per post per 30 days
                      </p>
                      {checkoutEnabled && plan.planId ? (
                        <Button asChild variant="outline" className="mt-2 h-11 w-full rounded-full">
                          <Link
                            href={`/billing/checkout?plan=${plan.planId}`}
                            aria-label={`Choose ${slots} live posts for ${term.label}, ${price}`}
                          >
                            Choose {term.label}
                          </Link>
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <p className="text-xs leading-5 text-muted-foreground">
        Paid once online, nothing renews. {ENTERPRISE_ADMINS_INCLUDED} named administrators can
        manage the posts. Every poster is still ID reviewed and every post reviewed before it goes
        live.{" "}
        {checkoutEnabled
          ? `More than ${ENTERPRISE_QUOTE_ABOVE_SLOTS} posts, or need a written quote for your procurement process?`
          : "Online checkout for these plans is paused."}{" "}
        <Link
          href={MULTI_LISTING_QUOTE_HREF}
          className="font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
        >
          Request a quote
        </Link>
        .
      </p>
    </div>
  );
}
