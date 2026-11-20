"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Images,
  LayoutGrid,
  Layers,
  RefreshCw,
  ShoppingBag,
  SquareCheckBig,
  TreePalm,
  User,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPlanPrice, formatThirtyDayEquivalent } from "@/lib/constants/pricing";
import { INDIVIDUAL_SLOT_LIMIT, POSTS_PER_SLOT_PER_30_DAYS } from "@/lib/billing/slot-checkout";
import {
  PACKAGE_MAX_SLOTS,
  PACKAGE_MIN_SLOTS,
  PACKAGE_POSTS_PER_SLOT_PER_30_DAYS,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
  packageTotalCents,
} from "@/lib/billing/slot-packages";
import { cn } from "@/lib/utils";
import type { RetailPricingOffer } from "@/components/billing/retail-pricing";

type OfferTab = "individual" | "multi-listing";

const TAB_DETAILS: Record<OfferTab, { label: string; icon: LucideIcon }> = {
  individual: { label: "Individual", icon: User },
  "multi-listing": { label: "Multi-listing", icon: Layers },
};

function IncludesStrip({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<{ icon: LucideIcon; text: ReactNode }>;
}) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card p-4 elev-xs sm:p-5">
      <h3 className="font-body text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: Icon, text }, index) => (
          <li
            key={index}
            className="flex items-center gap-3 text-sm font-medium leading-5 text-foreground"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green-700 dark:bg-brand-green/20 dark:text-brand-gold-300">
              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Market, Business or Tourism" with the three section icons underneath. */
function SectionsItem() {
  return (
    <span className="inline-flex flex-col">
      <span>Market, Business or Tourism</span>
      <span aria-hidden="true" className="mt-1 flex gap-1.5">
        <ShoppingBag className="h-3.5 w-3.5 text-brand-green-700 dark:text-brand-gold-300" />
        <Building2 className="h-3.5 w-3.5 text-brand-blue-700 dark:text-brand-blue-300" />
        <TreePalm className="h-3.5 w-3.5 text-teal-700 dark:text-teal-300" />
      </span>
    </span>
  );
}

function IndividualPanel({
  offers,
  onSale,
  onShowPackages,
}: {
  offers: RetailPricingOffer[];
  onSale: boolean;
  onShowPackages?: () => void;
}) {
  return (
    <div className="space-y-5">
      <IncludesStrip
        title="Every slot includes"
        items={[
          { icon: SquareCheckBig, text: "1 live post at a time" },
          { icon: Images, text: "10 photos and 1 video" },
          { icon: RefreshCw, text: `Up to ${POSTS_PER_SLOT_PER_30_DAYS} posts per 30 days` },
          { icon: LayoutGrid, text: <SectionsItem /> },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-5">
        {offers.map((offer) => {
          const term = `${offer.durationDays} days`;
          // An Individual slot works in every section, so every section's
          // plan id names the same plan; any one of them is the slot's link.
          const planId = offer.planIds.MZANSI_MARKET;
          const perThirtyDays = formatThirtyDayEquivalent(offer.priceCents, offer.durationDays);
          return (
            <article
              key={offer.tier}
              data-testid={`retail-offer-${offer.tier}`}
              // The three terms are equal choices: same card, same outlined button.
              className="spotlight flex flex-col rounded-3xl border border-border/70 bg-card p-5 text-card-foreground elev-xs sm:p-6"
            >
              <h3 className="font-body text-base font-semibold text-foreground">{term}</h3>
              <span
                data-testid="retail-offer-price"
                className="mt-2 font-display text-[2.6rem] font-extrabold leading-none tracking-tight text-foreground"
              >
                {formatPlanPrice(offer.priceCents)}
              </span>
              <p className="mt-1.5 min-h-5 text-xs font-medium text-muted-foreground">
                {perThirtyDays ? `${perThirtyDays} per 30 days` : "Paid once"}
              </p>
              {/* Checkout always confirms dates, slots and renewal before payment. */}
              {onSale && planId ? (
                <Button asChild variant="outline" className="mt-5 h-11 w-full rounded-full">
                  <Link href={`/billing/checkout?plan=${planId}`}>Choose {term}</Link>
                </Button>
              ) : (
                <Button variant="outline" className="mt-5 h-11 w-full rounded-full" disabled>
                  Opens soon
                </Button>
              )}
            </article>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        {`Hold up to ${INDIVIDUAL_SLOT_LIMIT} slots at a time.`}
        {onShowPackages ? (
          <>
            {" "}
            <button
              type="button"
              onClick={onShowPackages}
              className="rounded-sm font-semibold text-brand-green-700 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-brand-gold-300"
            >
              Need {PACKAGE_MIN_SLOTS} or more?
            </button>
          </>
        ) : null}
        <span className="mt-1 block text-xs">
          {onSale ? null : "Paid slots open soon; your first post and events are free. "}
          Prices in ZAR.{" "}
          <a
            href="#billing-faq"
            className="rounded-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            How billing works
          </a>
        </span>
      </p>
    </div>
  );
}

/** Shown only while packages are on sale (PACKAGES_ON_SALE). */
function MultiListingPanel() {
  const example = 10;
  return (
    <div className="space-y-5">
      <IncludesStrip
        title="Every package includes"
        items={[
          {
            icon: Layers,
            text: `${PACKAGE_MIN_SLOTS} to ${PACKAGE_MAX_SLOTS} slots, 1 live post each`,
          },
          { icon: Images, text: "10 photos and 1 video per post" },
          {
            icon: RefreshCw,
            text: `Up to ${PACKAGE_POSTS_PER_SLOT_PER_30_DAYS} posts go live per slot per 30 days`,
          },
          { icon: BadgeCheck, text: "ID review first. One package per account" },
        ]}
      />
      <article className="flex flex-col items-start gap-4 rounded-3xl border border-brand-green-600/60 bg-card p-5 ring-4 ring-brand-green/10 elev-lg sm:flex-row sm:items-center sm:justify-between sm:p-6 dark:border-brand-green-500/70">
        <div>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-[2.6rem] font-extrabold leading-none tracking-tight text-foreground">
              {formatPlanPrice(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)}
            </span>
            <span className="text-sm font-semibold text-muted-foreground">
              per slot per 30 days
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            30, 90 or 180 days. All slots end together.
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">
            {`Example: ${example} slots for 30 days = ${formatPlanPrice(packageTotalCents(example, 30))}`}
          </p>
        </div>
        <Button
          asChild
          variant="outline"
          className="h-11 w-full shrink-0 rounded-full px-6 sm:w-auto"
        >
          <Link href="/pricing/multi-listing">Choose your package</Link>
        </Button>
      </article>
    </div>
  );
}

function EventsStrip() {
  return (
    <div
      data-testid="free-events"
      className="flex flex-col gap-4 rounded-3xl border border-dashed border-teal-300/70 bg-teal-50/50 p-5 sm:flex-row sm:items-center sm:justify-between dark:border-teal-800/70 dark:bg-teal-950/20"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300">
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="font-display text-lg font-bold tracking-tight text-foreground">
            Events are free
          </h3>
          <p className="text-sm text-muted-foreground">
            No slot needed. Moderated, live until the event ends.
          </p>
        </div>
      </div>
      <Button asChild variant="outline" className="h-11 w-full shrink-0 rounded-full sm:w-auto">
        <Link href="/post/create-tourism?type=event">Post an event</Link>
      </Button>
    </div>
  );
}

/**
 * The pricing page's offers (owner's design of 18 November 2026, variant B):
 * one tab per offer that is on sale. While only Individual slots are sold the
 * tab row is not shown; the Multi-listing tab appears while packages are on
 * sale. Free events sit below the offers because they need no slot.
 * Billing rules (renewal, expiry, refunds) live once in `BillingFaq`.
 */
export function PricingOffers({
  offers,
  onSale,
  showMultiListing,
}: {
  offers: RetailPricingOffer[];
  onSale: boolean;
  /** Packages are on sale (PACKAGES_ON_SALE). */
  showMultiListing: boolean;
}) {
  const tabs: OfferTab[] = showMultiListing ? ["individual", "multi-listing"] : ["individual"];
  const [active, setActive] = useState<OfferTab>("individual");
  const tabRefs = useRef<Partial<Record<OfferTab, HTMLButtonElement | null>>>({});
  const showTabs = tabs.length > 1;

  const select = (tab: OfferTab, focus = false) => {
    setActive(tab);
    if (focus) tabRefs.current[tab]?.focus();
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(active);
    const next =
      event.key === "ArrowRight"
        ? tabs[(index + 1) % tabs.length]
        : event.key === "ArrowLeft"
          ? tabs[(index - 1 + tabs.length) % tabs.length]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[tabs.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    select(next, true);
  };

  const panel =
    active === "multi-listing" && showMultiListing ? (
      <MultiListingPanel />
    ) : (
      <IndividualPanel
        offers={offers}
        onSale={onSale}
        onShowPackages={showMultiListing ? () => select("multi-listing", true) : undefined}
      />
    );

  return (
    <div className="mx-auto max-w-5xl">
      {showTabs ? (
        <>
          <div
            role="tablist"
            aria-label="Offers"
            className="mx-auto grid w-full max-w-sm grid-cols-2 gap-1 rounded-full border border-border/70 bg-card p-1 elev-xs"
          >
            {tabs.map((tab) => {
              const { label, icon: Icon } = TAB_DETAILS[tab];
              const selected = tab === active;
              return (
                <button
                  key={tab}
                  ref={(node) => {
                    tabRefs.current[tab] = node;
                  }}
                  id={`offer-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  // Only the selected tab's panel is rendered.
                  aria-controls={selected ? `offer-panel-${tab}` : undefined}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(tab)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    "inline-flex h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[13px] font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm",
                    selected
                      ? "bg-brand-green-600 text-white shadow-sm dark:bg-brand-green-500 dark:text-brand-green-950"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
          <div
            id={`offer-panel-${active}`}
            role="tabpanel"
            aria-labelledby={`offer-tab-${active}`}
            className="mt-7"
          >
            {panel}
          </div>
        </>
      ) : (
        panel
      )}

      <div className="mt-8">
        <EventsStrip />
      </div>
    </div>
  );
}
