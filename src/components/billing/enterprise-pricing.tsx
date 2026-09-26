import Link from "next/link";
import { Building2, Landmark, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPlanPrice } from "@/lib/constants/pricing";
import type { EnterpriseCatalogPlan } from "@/lib/commercial/plans";

const TERMS = [
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "12 months" },
] as const;

/**
 * Organisations & large businesses. Bulk plans sell simultaneous ACTIVE slots;
 * 1,000+ and organisation programmes are quoted. No maximum price is published.
 */
export function EnterprisePricing({
  plans,
  checkoutEnabled,
}: {
  plans: EnterpriseCatalogPlan[];
  checkoutEnabled: boolean;
}) {
  const sizes = [...new Set(plans.map((plan) => plan.slots))].sort((a, b) => a - b);
  const priceFor = (slots: number, days: number) =>
    plans.find((plan) => plan.slots === slots && plan.durationDays === days);

  return (
    <section
      id="enterprise"
      aria-labelledby="enterprise-pricing-title"
      className="mx-auto max-w-5xl scroll-mt-24 rounded-2xl border border-border/70 bg-card p-5 sm:p-7"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h2 id="enterprise-pricing-title" className="font-display text-xl font-semibold">
            Organisations &amp; large businesses
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            Bulk posting and sponsored business programmes for dealerships, retailers, tourism
            groups, municipalities, chambers and enterprise-development programmes. Starting from 50
            active positions — reuse a position whenever a listing sells or ends.
          </p>
        </div>
        <Button asChild className="h-11 shrink-0 rounded-full font-semibold">
          <Link href="/contact?topic=organisation_proposal">Request a proposal</Link>
        </Button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: Building2,
            title: "Bulk active slots",
            text: "Keep a fixed pool of listings live across Market, Business and Tourism.",
          },
          {
            icon: Landmark,
            title: "Organisation network",
            text: "Confirm programme participants and show your authorised affiliation badge.",
          },
          {
            icon: Users,
            title: "Sponsored businesses",
            text: "Fund visibility for an agreed cohort, with reporting on engagement.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-xl border border-border/60 p-4">
            <Icon aria-hidden="true" className="h-5 w-5 text-brand-green" />
            <p className="mt-2 text-sm font-semibold">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>

      {sizes.length > 0 ? (
        <details className="mt-5 rounded-xl border border-border/60">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Bulk active-slot pricing
          </summary>
          <div className="border-t border-border/60 p-4">
            {/* Stacked cards on mobile, a compact table from sm upwards. */}
            <div className="grid gap-3 sm:hidden">
              {sizes.map((slots) => (
                <div key={slots} className="rounded-lg border border-border/60 p-3">
                  <p className="text-sm font-semibold">{slots} active slots</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    {TERMS.map((term) => (
                      <div key={term.days}>
                        <dt className="text-muted-foreground">{term.label}</dt>
                        <dd className="font-semibold">
                          {priceFor(slots, term.days)
                            ? formatPlanPrice(priceFor(slots, term.days)!.priceCents)
                            : "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
            <table className="hidden w-full text-sm sm:table">
              <caption className="sr-only">Bulk active-slot prices</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    Active slots
                  </th>
                  {TERMS.map((term) => (
                    <th key={term.days} scope="col" className="py-2 font-medium">
                      {term.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sizes.map((slots) => (
                  <tr key={slots} className="border-t border-border/60">
                    <th scope="row" className="py-2 text-left font-semibold">
                      {slots}
                    </th>
                    {TERMS.map((term) => {
                      const plan = priceFor(slots, term.days);
                      return (
                        <td key={term.days} className="py-2">
                          {plan ? (
                            checkoutEnabled && plan.planId ? (
                              <Link
                                className="font-semibold underline-offset-4 hover:underline"
                                href={`/billing/checkout?plan=${plan.planId}`}
                              >
                                {formatPlanPrice(plan.priceCents)}
                              </Link>
                            ) : (
                              formatPlanPrice(plan.priceCents)
                            )
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">
              1,000+ active slots, organisation networks and sponsored programmes: custom enterprise
              pricing on request. Government and public-sector engagements follow the
              organisation&apos;s procurement requirements.
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
