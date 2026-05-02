"use client";

import Link from "next/link";
import { Check, Megaphone, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SubscribeButton } from "@/components/billing/subscribe-button";
import {
  formatPlanPrice,
  getPlanCheckoutId,
  getPlanFeatureItems,
  PLANS,
  type PlanDefinition,
} from "@/lib/constants/pricing";
import { AREA_LABELS, type MarketplaceArea } from "@/types/enums";

type PostAccountButtonProps = {
  accountTitle: string;
  area: MarketplaceArea;
  postHref: string;
};

function getBoostSummary(plan: PlanDefinition): string {
  if (plan.features.featuredAllowed && plan.features.urgentAllowed) {
    return "Maximum boost: featured placement, urgent badge, and boosted visibility.";
  }

  if (plan.features.boostAllowed) {
    return "Boosted visibility is included for this package level.";
  }

  return "Standard posting package with verified account visibility.";
}

export function PostAccountButton({ accountTitle, area, postHref }: PostAccountButtonProps) {
  const plans = PLANS.filter((plan) => plan.area === area);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-11 gap-1.5 px-3"
          aria-label={`Post from ${accountTitle}`}
          title={`Post from ${accountTitle}`}
        >
          <Megaphone className="h-3.5 w-3.5" />
          Post
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle>Choose a posting package</DialogTitle>
          <DialogDescription>
            Select and pay for a {AREA_LABELS[area]} package. Your account gets posting capacity and
            boost tools based on the package you choose.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border">
          <div className="hidden grid-cols-[1.1fr_0.9fr_1.4fr_1fr] gap-4 border-b bg-muted/40 px-4 py-3 text-xs font-semibold uppercase text-muted-foreground md:grid">
            <span>Package</span>
            <span>Price</span>
            <span>Boost level</span>
            <span>Pay</span>
          </div>

          <div className="divide-y">
            {plans.map((plan) => (
              <div
                key={`${plan.area}-${plan.tier}`}
                className="grid gap-4 px-4 py-4 md:grid-cols-[1.1fr_0.9fr_1.4fr_1fr] md:items-start"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-display text-base font-semibold">{plan.name}</p>
                    {plan.tier === "growth" && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-green px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                        <Sparkles className="h-3 w-3" />
                        Popular
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {getPlanFeatureItems(plan)
                      .slice(0, 4)
                      .map((feature) => (
                        <li key={feature.text} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-green" />
                          <span>{feature.text}</span>
                        </li>
                      ))}
                  </ul>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground md:hidden">
                    Price
                  </p>
                  <p className="font-display text-2xl font-bold">
                    {formatPlanPrice(plan.priceCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">30 days</p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground md:hidden">
                    Boost level
                  </p>
                  <p className="text-sm text-foreground">{getBoostSummary(plan)}</p>
                </div>

                <SubscribeButton
                  planId={getPlanCheckoutId(plan)}
                  planName={plan.name}
                  priceCents={plan.priceCents}
                  isPopular={plan.tier === "growth"}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <span>Already have an active package for this account?</span>
          <Button asChild variant="outline" size="sm">
            <Link href={postHref}>Continue to post</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
