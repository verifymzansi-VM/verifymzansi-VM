import Link from "next/link";
import { ArrowRight, Check, Crown, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubscribeButton } from "@/components/billing/subscribe-button";
import {
  formatPlanPrice,
  getPlanCheckoutHref,
  getPlanCheckoutId,
  getPlanFeatureItems,
  type PlanDefinition,
} from "@/lib/constants/pricing";

function gridClassName(planCount: number): string {
  return `grid grid-cols-1 gap-6 md:grid-cols-2 ${
    planCount >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
  }`;
}

function PlanBadge({ plan }: { plan: PlanDefinition }) {
  if (plan.tier === "growth") {
    return (
      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
        <Badge className="bg-brand-green px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white hover:bg-brand-green">
          <Sparkles className="mr-1 h-3 w-3" />
          Most Popular
        </Badge>
      </div>
    );
  }

  if (plan.tier === "pro") {
    return (
      <div className="absolute -top-4 left-1/2 -translate-x-1/2">
        <Badge className="bg-brand-gold px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-950 hover:bg-brand-gold">
          <Crown className="mr-1 h-3 w-3" />
          Premium
        </Badge>
      </div>
    );
  }

  return null;
}

export function PricingPlanGrid({ plans }: { plans: PlanDefinition[] }) {
  return (
    <div className={gridClassName(plans.length)}>
      {plans.map((plan) => (
        <Card
          key={`${plan.area}-${plan.tier}`}
          className={plan.tier === "growth" ? "relative border-brand-green shadow-lg" : "relative"}
        >
          <PlanBadge plan={plan} />
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{plan.name}</CardTitle>
            <div className="pt-1">
              <div>
                <span className="font-display text-3xl font-bold">
                  {formatPlanPrice(plan.priceCents)}
                </span>
                <span className="text-sm text-muted-foreground">/ 30 days</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                30-day subscription entitlement. No payment is made until you approve hosted
                checkout.
              </p>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {getPlanFeatureItems(plan).map((feature) => (
                <li key={feature.text} className="flex items-start gap-2 text-sm">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green"
                  />
                  {feature.text}
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                Auto-renewal: not charged without checkout confirmation. Cancel or switch plans from
                billing/support before buying another plan for the same area.
              </p>
              <p className="mt-1">
                Moderation still applies. Rejected paid content may qualify for correction,
                resubmission, credit, or refund review.
              </p>
            </div>
            <div className="mt-6">
              <Button
                asChild
                className="w-full gap-2"
                variant={plan.tier === "growth" ? "default" : "outline"}
              >
                <Link href={getPlanCheckoutHref(plan)}>
                  Choose {plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1)}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BillingPlanGrid({ plans }: { plans: PlanDefinition[] }) {
  return (
    <div className={gridClassName(plans.length)}>
      {plans.map((plan) => (
        <Card
          key={`${plan.area}-${plan.tier}`}
          className={`relative flex flex-col ${
            plan.tier === "growth"
              ? "z-10 border-brand-green bg-background shadow-xl ring-2 ring-brand-green/20"
              : "border-border/50 shadow-sm"
          }`}
        >
          <PlanBadge plan={plan} />
          <CardHeader className="pb-4 pt-4 text-center">
            <CardTitle className="font-display text-xl font-medium text-muted-foreground">
              {plan.name}
            </CardTitle>
            <div className="mt-4 flex items-baseline justify-center gap-1">
              <span className="font-display text-3xl font-bold">
                {formatPlanPrice(plan.priceCents)}
              </span>
              <span className="text-sm font-medium text-muted-foreground">/ 30 days</span>
            </div>
          </CardHeader>

          <CardContent className="flex flex-1 flex-col">
            <ul className="mb-6 flex-1 space-y-2">
              {getPlanFeatureItems(plan).map((feature) => (
                <li key={feature.text} className="flex items-start gap-3 text-sm">
                  <Check aria-hidden="true" className="h-5 w-5 flex-shrink-0 text-brand-green" />
                  <span className="font-medium text-foreground">{feature.text}</span>
                </li>
              ))}
            </ul>

            <SubscribeButton
              planId={getPlanCheckoutId(plan)}
              planName={plan.name}
              priceCents={plan.priceCents}
              isPopular={plan.tier === "growth"}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
