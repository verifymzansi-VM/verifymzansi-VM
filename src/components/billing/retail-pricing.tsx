"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Building2,
  CalendarDays,
  Check,
  Crown,
  Gift,
  ShoppingBag,
  Sparkles,
  TreePalm,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatPlanPrice,
  formatThirtyDayEquivalent,
  getRetailSavingsCents,
} from "@/lib/constants/pricing";
import { cn } from "@/lib/utils";
import type { MarketplaceArea, RetailPlanTier } from "@/types/enums";

export interface RetailPricingOffer {
  tier: RetailPlanTier;
  label: string;
  priceCents: number;
  durationDays: number;
  promoLabel: string;
  compareAtCents?: number;
  planIds: Record<MarketplaceArea, string>;
}

const AREA_OPTIONS: ReadonlyArray<{
  value: MarketplaceArea;
  label: string;
  short: string;
  icon: typeof ShoppingBag;
  activeIcon: string;
}> = [
  {
    value: "MZANSI_MARKET",
    label: "Mzansi Market",
    short: "Market",
    icon: ShoppingBag,
    activeIcon: "text-brand-green-700 dark:text-brand-green-300",
  },
  {
    value: "MZANSI_BUSINESS",
    label: "Mzansi Business",
    short: "Business",
    icon: Building2,
    activeIcon: "text-brand-blue-700 dark:text-brand-blue-300",
  },
  {
    value: "PROMOTIONS_EVENTS",
    label: "Tourism",
    short: "Tourism",
    icon: TreePalm,
    activeIcon: "text-sunset-700 dark:text-sunset-300",
  },
];

const AREA_UNIT: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "1 active listing at a time",
  MZANSI_BUSINESS: "1 business profile",
  PROMOTIONS_EVENTS: "1 tourism listing at a time",
};

function OfferBadge({ tier, label }: { tier: RetailPlanTier; label: string }) {
  if (tier === "month") return null;
  const best = tier === "half_year";
  const Icon = best ? Crown : Sparkles;
  return (
    <span
      className={cn(
        "absolute -top-3 left-5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold shadow-sm",
        best
          ? "bg-brand-gold text-brand-gold-950"
          : "bg-brand-green-600 text-white dark:bg-brand-green-500 dark:text-brand-green-950"
      )}
    >
      <Icon aria-hidden="true" className="h-3 w-3" />
      {label}
    </span>
  );
}

function FeatureItem({ children, strong }: { children: ReactNode; strong?: boolean }) {
  return (
    <li
      className={cn(
        "flex items-start gap-2.5 text-sm leading-5",
        strong
          ? "font-semibold text-brand-green-700 dark:text-brand-green-300"
          : "text-foreground/85"
      )}
    >
      <span className="mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-brand-green-700 dark:bg-brand-green/20 dark:text-brand-green-300">
        <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The public retail ladder: R50 / 30 days, R140 / 90 days, R250 / 180 days and free Events. The same price
 * applies in every section; the section picker only chooses where the slot is used.
 * Billing rules (renewal, expiry, refunds) live once in `BillingFaq`, not in each card.
 */
/** Tourism leads with the free introductory trial before the paid ladder. */
function TourismTrialCard({ shortDays, longDays }: { shortDays: number; longDays: number }) {
  return (
    <div
      data-testid="tourism-free-trial"
      className="mt-8 flex flex-col gap-4 rounded-3xl border border-brand-green/30 bg-brand-green-50 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 dark:bg-brand-green/10"
    >
      <div className="flex items-start gap-3">
        <span className="area-market-tile flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
          <Gift aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <p className="font-display text-xl font-bold tracking-tight">
            Start free: {shortDays} days, or {longDays} days while places last
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            One free trial per verified person. No payment, nothing renews.
          </p>
        </div>
      </div>
      <Button asChild variant="trust-verified" className="h-11 shrink-0 rounded-full px-5">
        <Link href="/post/create-tourism?type=tourism">Start free trial</Link>
      </Button>
    </div>
  );
}

export function RetailPricing({
  offers,
  defaultArea = "MZANSI_MARKET",
  trialDays = { shortDays: 7, longDays: 30 },
}: {
  offers: RetailPricingOffer[];
  defaultArea?: MarketplaceArea;
  trialDays?: { shortDays: number; longDays: number };
}) {
  const [area, setArea] = useState<MarketplaceArea>(defaultArea);
  const areaLabel = AREA_OPTIONS.find((o) => o.value === area)?.label ?? "";

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-col items-center gap-2.5">
        <p id="retail-area-label" className="text-sm font-semibold text-foreground">
          Where will you post?
        </p>
        <div
          role="radiogroup"
          aria-labelledby="retail-area-label"
          className="grid w-full max-w-lg grid-cols-3 gap-1 rounded-full border border-border/70 bg-card p-1 elev-xs"
        >
          {AREA_OPTIONS.map((option) => {
            const active = area === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setArea(option.value)}
                className={cn(
                  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm",
                  active
                    ? "bg-muted text-foreground shadow-sm ring-1 ring-border dark:bg-warm-800"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn("h-4 w-4 shrink-0", active ? option.activeIcon : "")}
                />
                <span className="sm:hidden">{option.short}</span>
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {area === "PROMOTIONS_EVENTS" ? (
        <TourismTrialCard shortDays={trialDays.shortDays} longDays={trialDays.longDays} />
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
        {offers.map((offer) => {
          const highlighted = offer.tier === "quarter";
          const best = offer.tier === "half_year";
          const planId = offer.planIds[area];
          const planName = `${offer.label} — ${areaLabel}`;
          const perThirtyDays = formatThirtyDayEquivalent(offer.priceCents, offer.durationDays);
          const savings = offer.tier !== "month" ? getRetailSavingsCents(offer) : 0;
          return (
            <article
              key={offer.tier}
              data-testid={`retail-offer-${offer.tier}`}
              className={cn(
                "relative flex flex-col rounded-3xl border bg-card p-5 pt-7 text-card-foreground transition-all duration-200 sm:p-6 sm:pt-8",
                highlighted
                  ? "border-brand-green-600/70 ring-4 ring-brand-green/10 elev-lg dark:border-brand-green-500/70 lg:-translate-y-2"
                  : best
                    ? "border-brand-gold/60 elev-xs hover:elev-md"
                    : "border-border/70 elev-xs hover:elev-md"
              )}
            >
              <OfferBadge tier={offer.tier} label={offer.promoLabel} />
              <h3 className="font-body text-base font-semibold text-foreground">{offer.label}</h3>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-display text-[2.6rem] font-extrabold leading-none tracking-tight text-foreground">
                  {formatPlanPrice(offer.priceCents)}
                </span>
              </div>
              <p className="mt-1.5 min-h-5 text-xs font-medium text-muted-foreground">
                {perThirtyDays ? `${perThirtyDays} per 30 days` : "Paid once"}
              </p>

              <ul className="mt-5 flex-1 space-y-2.5 border-t border-border/60 pt-5">
                <FeatureItem>{AREA_UNIT[area]}</FeatureItem>
                <FeatureItem>10 photos and 1 video</FeatureItem>
                <FeatureItem>Boost &amp; Featured add-ons</FeatureItem>
                {savings > 0 ? (
                  <FeatureItem strong>Save {formatPlanPrice(savings)} vs. 30-day plans</FeatureItem>
                ) : null}
              </ul>

              {/* Checkout always confirms dates, slots and renewal before payment. */}
              <Button
                asChild
                variant={highlighted ? "trust-verified" : "outline"}
                className="mt-6 h-11 w-full rounded-full"
              >
                <Link href={`/billing/checkout?plan=${planId}`} aria-label={`Choose ${planName}`}>
                  Choose {offer.label}
                </Link>
              </Button>
            </article>
          );
        })}

        <article className="relative flex flex-col rounded-3xl border border-dashed border-sunset-300/70 bg-sunset-50/50 p-5 pt-7 dark:border-sunset-800/70 dark:bg-sunset-950/20 sm:p-6 sm:pt-8">
          <h3 className="font-body text-base font-semibold text-sunset-700 dark:text-sunset-300">
            Events
          </h3>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-[2.6rem] font-extrabold leading-none tracking-tight text-foreground">
              Free
            </span>
          </div>
          <p className="mt-1.5 min-h-5 text-xs font-medium text-muted-foreground">
            Until the event ends
          </p>
          <ul className="mt-5 flex-1 space-y-2.5 border-t border-sunset-200/70 pt-5 dark:border-sunset-900/60">
            {["No plan needed", "Moderated, fair use"].map((text) => (
              <li
                key={text}
                className="flex items-start gap-2.5 text-sm leading-5 text-foreground/85"
              >
                <CalendarDays
                  aria-hidden="true"
                  className="mt-px h-[18px] w-[18px] shrink-0 text-sunset-600 dark:text-sunset-300"
                />
                {text}
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-6 h-11 w-full rounded-full">
            <Link href="/post/create-tourism?type=event">Post an event</Link>
          </Button>
        </article>
      </div>

      <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">
        Prices in ZAR. Nothing renews automatically.{" "}
        <a
          href="#billing-faq"
          className="rounded-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          How billing works
        </a>
      </p>
    </div>
  );
}
