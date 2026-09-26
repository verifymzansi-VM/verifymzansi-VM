"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Crown, Gift, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPlanPrice, getRetailSavingsCents } from "@/lib/constants/pricing";
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

const AREA_OPTIONS: ReadonlyArray<{ value: MarketplaceArea; label: string; short: string }> = [
  { value: "MZANSI_MARKET", label: "Mzansi Market", short: "Market" },
  { value: "MZANSI_BUSINESS", label: "Mzansi Business", short: "Business" },
  { value: "PROMOTIONS_EVENTS", label: "Tourism", short: "Tourism" },
];

const AREA_UNIT: Record<MarketplaceArea, string> = {
  MZANSI_MARKET: "1 active listing at a time",
  MZANSI_BUSINESS: "Your business profile",
  PROMOTIONS_EVENTS: "1 tourism listing at a time",
};

function OfferBadge({ tier, label }: { tier: RetailPlanTier; label: string }) {
  if (tier === "month") return null;
  const best = tier === "year";
  const Icon = best ? Crown : Sparkles;
  return (
    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
      <Badge
        className={
          best
            ? "whitespace-nowrap bg-brand-gold px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-950 shadow-sm hover:bg-brand-gold"
            : "whitespace-nowrap bg-brand-green px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white shadow-sm hover:bg-brand-green"
        }
      >
        <Icon aria-hidden="true" className="mr-1 h-3 w-3" />
        {label}
      </Badge>
    </div>
  );
}

function OfferFeatures({ offer, area }: { offer: RetailPricingOffer; area: MarketplaceArea }) {
  const items = [
    AREA_UNIT[area],
    "Reuse your slot when an item sells",
    "10 photos and 1 video per post",
    "No automatic renewal",
  ];
  return (
    <ul className="space-y-2">
      {items.map((text) => (
        <li key={text} className="flex items-start gap-2 text-sm">
          <Check aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green" />
          <span className="text-foreground/90">{text}</span>
        </li>
      ))}
      {offer.tier !== "month" && getRetailSavingsCents(offer) > 0 ? (
        <li className="flex items-start gap-2 text-sm font-medium text-brand-green-700 dark:text-brand-green-300">
          <Check aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0" />
          Save {formatPlanPrice(getRetailSavingsCents(offer))} vs. monthly
        </li>
      ) : null}
    </ul>
  );
}

/**
 * The public retail ladder: R50 / R250 / R450 and free Events. The same price
 * applies in every section; the section picker only chooses where the slot is used.
 */
/** Tourism leads with the free introductory trial before the paid ladder. */
function TourismTrialCard({ shortDays, longDays }: { shortDays: number; longDays: number }) {
  return (
    <Card
      data-testid="tourism-free-trial"
      className="border-brand-green/50 bg-brand-green/5 ring-1 ring-brand-green/15"
    >
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand-green">
            <Gift aria-hidden="true" className="h-4 w-4" />
            Free trial — Tourism
          </p>
          <p className="font-display text-2xl font-bold tracking-tight">
            Start free: {shortDays} days, or a limited {longDays}-day launch trial
          </p>
          <p className="text-sm text-muted-foreground">
            One introductory choice per verified person. {longDays}-day places are limited and
            confirmed on approval. No payment details, no automatic charge — your listing stays
            saved in your dashboard when the trial ends.
          </p>
        </div>
        <Button asChild className="h-11 shrink-0 gap-2 rounded-full font-semibold">
          <Link href="/post/create-tourism?type=tourism">
            Start free trial
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
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

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div
        role="radiogroup"
        aria-label="Where will you post?"
        className="mx-auto grid w-full max-w-md grid-cols-3 rounded-full bg-muted/50 p-1"
      >
        {AREA_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={area === option.value}
            onClick={() => setArea(option.value)}
            className={`h-11 rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm ${
              area === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="sm:hidden">{option.short}</span>
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        One price in every section. Choose where your slot will be used.
      </p>

      {area === "PROMOTIONS_EVENTS" ? (
        <TourismTrialCard shortDays={trialDays.shortDays} longDays={trialDays.longDays} />
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {offers.map((offer) => {
          const highlighted = offer.tier === "half_year";
          const best = offer.tier === "year";
          const planId = offer.planIds[area];
          const planName = `${offer.label} — ${AREA_OPTIONS.find((o) => o.value === area)?.label}`;
          return (
            <Card
              key={offer.tier}
              data-testid={`retail-offer-${offer.tier}`}
              className={`relative flex flex-col transition-all duration-200 hover:-translate-y-0.5 ${
                highlighted
                  ? "border-brand-green/60 ring-2 ring-brand-green/15 elev-md hover:elev-lg"
                  : best
                    ? "border-brand-gold/60 ring-1 ring-brand-gold/20 hover:elev-md"
                    : "border-border/60 hover:elev-md"
              }`}
            >
              <OfferBadge tier={offer.tier} label={offer.promoLabel} />
              <CardHeader className="pb-2 pt-6">
                <CardTitle className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {offer.label}
                </CardTitle>
                <div className="flex items-baseline gap-2 pt-1">
                  <span className="font-display text-4xl font-bold tracking-tight">
                    {formatPlanPrice(offer.priceCents)}
                  </span>
                  {offer.compareAtCents ? (
                    <span className="text-sm text-muted-foreground line-through">
                      {formatPlanPrice(offer.compareAtCents)}
                    </span>
                  ) : null}
                </div>
                {offer.tier === "month" ? (
                  <p className="text-xs font-medium text-muted-foreground">{offer.promoLabel}</p>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="flex-1">
                  <OfferFeatures offer={offer} area={area} />
                </div>
                <div className="mt-6">
                  {/* Checkout always confirms dates, slots and renewal before payment. */}
                  <Button
                    asChild
                    className="h-11 w-full gap-2 rounded-full font-semibold"
                    variant={highlighted ? "default" : "outline"}
                  >
                    <Link
                      href={`/billing/checkout?plan=${planId}`}
                      aria-label={`Choose ${planName}`}
                    >
                      Choose {offer.label}
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        <Card className="relative flex flex-col border-dashed border-border/80 bg-muted/20">
          <CardHeader className="pb-2 pt-6">
            <CardTitle className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Events
            </CardTitle>
            <div className="flex items-baseline gap-1 pt-1">
              <span className="font-display text-4xl font-bold tracking-tight">Free</span>
            </div>
            <p className="text-xs font-medium text-muted-foreground">Until the event ends</p>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col">
            <ul className="flex-1 space-y-2 text-sm">
              {[
                "No trial or plan needed",
                "Visible until the end date",
                "Moderated, fair-use limits",
              ].map((text) => (
                <li key={text} className="flex items-start gap-2">
                  <CalendarDays
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green"
                  />
                  <span className="text-foreground/90">{text}</span>
                </li>
              ))}
            </ul>
            <Button
              asChild
              variant="outline"
              className="mt-6 h-11 w-full rounded-full font-semibold"
            >
              <Link href="/post/create-tourism?type=event">Post an event</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
