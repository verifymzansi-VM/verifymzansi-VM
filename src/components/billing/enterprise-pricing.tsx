import Link from "next/link";
import { ArrowRight, Building2, Landmark, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  SPONSOR_PROGRAMME_ADMINS,
  SPONSOR_PROGRAMME_PRICES,
  formatPlanPrice,
} from "@/lib/constants/pricing";
import {
  PACKAGE_MIN_SLOTS,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
  packageTotalCents,
} from "@/lib/billing/slot-packages";
import type { EnterpriseCatalogPlan } from "@/lib/commercial/plans";
import { SHOW_SPONSOR_OFFER } from "@/lib/hidden-features";
import { cn } from "@/lib/utils";
import { MultiListingPlans } from "@/components/billing/multi-listing-plans";

const PROPOSAL_HREF = "/contact?topic=organisation_proposal";

/**
 * Package chooser plus the Group 2 multi-listing plans (bought online) and the Group 3
 * Business Sponsor fees (by proposal). Multi-listing sells simultaneous LIVE posts for 90 or
 * 180 days; above 100 posts and larger sponsor programmes are quoted (Document 03 §3, §5). Who each package is for,
 * and everything it includes, is explained on /advertise.
 */
export function EnterprisePricing({
  retailFromCents,
  onlineMaxCents = null,
}: {
  /** Kept for callers; the package prices follow the P4a rules (slot-packages.ts). */
  plans: EnterpriseCatalogPlan[];
  /** Kept for callers; packages are bought on the checkout only while on sale. */
  checkoutEnabled: boolean;
  /** Cheapest retail price, shown on the Individual card; null when no retail offer is live. */
  retailFromCents: number | null;
  /** The most one online (Ozow) payment may be; above it a package is by invoice. */
  onlineMaxCents?: number | null;
}) {
  const sponsorFrom = SPONSOR_PROGRAMME_PRICES[0]!;
  const sponsorMax = SPONSOR_PROGRAMME_PRICES[SPONSOR_PROGRAMME_PRICES.length - 1]!;

  const packages = [
    {
      icon: User,
      name: "Individual",
      who: "Anyone selling one thing or running one business profile.",
      price: retailFromCents === null ? "See plans" : `From ${formatPlanPrice(retailFromCents)}`,
      per: retailFromCents === null ? "" : "for 30 days",
      detail: "30, 90 or 180 days. The prices are in the plans above.",
      href: "/advertise#individual",
      priceHref: "#plans",
      priceCta: "See individual plans",
    },
    {
      icon: Building2,
      name: "Multi-listing",
      who: "Dealers, agencies, shops and landlords with several things to list.",
      price: `From ${formatPlanPrice(packageTotalCents(PACKAGE_MIN_SLOTS, 30))}`,
      per: "for 30 days",
      detail: `From ${PACKAGE_MIN_SLOTS} slots at ${formatPlanPrice(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per slot per 30 days, for 30, 90 or 180 days.`,
      href: "/advertise#multi-listing",
      priceHref: "#multi-listing-prices",
      priceCta: "Choose a multi-listing plan",
    },
    {
      icon: Landmark,
      name: "Business Sponsor",
      who: "Chambers, municipalities, development programmes and companies that support local businesses.",
      price: `From ${formatPlanPrice(sponsorFrom.price90Cents)}`,
      per: "for 90 days",
      detail: `Support ${sponsorFrom.capacity} to ${sponsorMax.capacity} businesses.`,
      href: "/advertise#programmes",
      priceHref: "#programme-prices",
      priceCta: "See sponsor fees",
    },
    // The sponsor offer is on hold (src/lib/hidden-features.ts).
  ].filter((pkg) => SHOW_SPONSOR_OFFER || pkg.name !== "Business Sponsor");

  return (
    <section
      id="enterprise"
      aria-labelledby="enterprise-pricing-title"
      className="mx-auto max-w-6xl scroll-mt-24 rounded-3xl border border-border/70 bg-card p-5 elev-xs sm:p-8"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h2 id="enterprise-pricing-title" className="section-title">
            Choose the package that fits
          </h2>
          <p className="section-lede">
            {packages.length === 3 ? "Three" : "Two"} ways to advertise, depending on who you are
            and how much you need to list. See who each one is for, then go straight to its prices.
          </p>
        </div>
      </div>

      <ul
        className={cn(
          "mt-6 grid gap-4",
          packages.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"
        )}
      >
        {packages.map(
          ({ icon: Icon, name, who, price, per, detail, href, priceHref, priceCta }) => (
            <li
              key={name}
              className="spotlight flex flex-col rounded-2xl border border-border/70 bg-muted/40 p-5"
            >
              <span className="icon-tile h-11 w-11 rounded-2xl area-business-tile">
                <Icon aria-hidden="true" className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-display text-xl font-bold text-foreground">{name}</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">Who it is for: </span>
                {who}
              </p>
              <p className="mt-4 font-display text-2xl font-extrabold tracking-tight text-foreground">
                {price} <span className="text-sm font-semibold text-muted-foreground">{per}</span>
              </p>
              <p className="mt-1 flex-1 text-sm leading-6 text-muted-foreground">{detail}</p>
              <div className="mt-5 flex flex-col gap-1">
                <Button asChild variant="outline" className="h-11 w-full rounded-full">
                  <Link href={priceHref}>{priceCta}</Link>
                </Button>
                <Link
                  href={href}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 text-sm font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-gold-300"
                >
                  Full details of {name}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>
            </li>
          )
        )}
      </ul>

      <div id="multi-listing-prices" className="mt-6 scroll-mt-28 space-y-3">
        <h3 className="font-display text-lg font-bold text-foreground">Multi-listing plans</h3>
        <MultiListingPlans onlineMaxCents={onlineMaxCents} />
      </div>

      {SHOW_SPONSOR_OFFER ? (
        <div id="programme-prices" className="mt-4 scroll-mt-28 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border/70">
            <table className="w-full text-sm">
              <caption className="bg-muted/60 px-4 py-3 text-left font-semibold text-foreground">
                Sponsor fee (total for the term)
              </caption>
              <thead>
                <tr className="border-t border-border/60 text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Businesses
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    90 days
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    180 days
                  </th>
                </tr>
              </thead>
              <tbody>
                {SPONSOR_PROGRAMME_PRICES.map((row) => (
                  <tr key={row.capacity} className="border-t border-border/60">
                    <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                      Up to {row.capacity}
                    </th>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatPlanPrice(row.price90Cents)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {formatPlanPrice(row.price180Cents)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border/60">
                  <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                    More than {sponsorMax.capacity}
                  </th>
                  <td colSpan={2} className="px-4 py-2.5 text-muted-foreground">
                    Custom proposal
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Includes {SPONSOR_PROGRAMME_ADMINS} named administrators. Nothing renews or charges
            automatically.
          </p>
          <Button asChild variant="ink" className="h-11 w-full rounded-full sm:w-auto">
            <Link href={PROPOSAL_HREF}>Request a sponsor proposal</Link>
          </Button>
        </div>
      ) : null}
    </section>
  );
}
