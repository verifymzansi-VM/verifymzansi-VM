import Link from "next/link";
import { Building2, ChevronDown, Landmark, Users } from "lucide-react";
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
      className="mx-auto max-w-6xl scroll-mt-24 rounded-3xl border border-border/70 bg-card p-5 elev-xs sm:p-8"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <h2 id="enterprise-pricing-title" className="section-title">
            Organisations &amp; large businesses
          </h2>
          <p className="section-lede">
            Bulk slots and sponsored programmes, from 50 active positions.
          </p>
        </div>
        <Button asChild variant="ink" className="h-11 w-full shrink-0 rounded-full md:w-auto">
          <Link href="/contact?topic=organisation_proposal">Request a proposal</Link>
        </Button>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: Building2,
            title: "Bulk active slots",
            text: "A pool of listings across every section.",
          },
          {
            icon: Landmark,
            title: "Organisation network",
            text: "An affiliation badge for your members.",
          },
          {
            icon: Users,
            title: "Sponsored businesses",
            text: "Fund visibility, with reporting.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-2xl bg-muted/60 p-4 sm:block">
            <span className="icon-tile h-9 w-9 area-business-tile">
              <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <h3 className="font-body text-sm font-semibold text-foreground sm:mt-3">{title}</h3>
              <p className="mt-0.5 text-sm leading-6 text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ul>

      {sizes.length > 0 ? (
        <details className="group mt-4 rounded-2xl border border-border/70">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            See bulk active-slot prices
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
            />
          </summary>
          <div className="border-t border-border/60 p-4">
            {/* Stacked cards on mobile, a compact table from sm upwards. */}
            <div className="grid gap-3 sm:hidden">
              {sizes.map((slots) => (
                <div key={slots} className="rounded-xl bg-muted/60 p-3">
                  <p className="text-sm font-semibold text-foreground">{slots} active slots</p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    {TERMS.map((term) => (
                      <div key={term.days}>
                        <dt className="text-muted-foreground">{term.label}</dt>
                        <dd className="font-semibold text-foreground">
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
                    <th scope="row" className="py-2.5 text-left font-semibold text-foreground">
                      {slots}
                    </th>
                    {TERMS.map((term) => {
                      const plan = priceFor(slots, term.days);
                      return (
                        <td key={term.days} className="py-2.5 tabular-nums">
                          {plan ? (
                            checkoutEnabled && plan.planId ? (
                              <Link
                                className="rounded-sm font-semibold text-brand-green-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-green-300"
                                href={`/billing/checkout?plan=${plan.planId}`}
                                aria-label={`Choose ${slots} active slots for ${term.label}, ${formatPlanPrice(plan.priceCents)}`}
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
              1,000+ slots and public-sector programmes: priced on request.
            </p>
          </div>
        </details>
      ) : null}
    </section>
  );
}
