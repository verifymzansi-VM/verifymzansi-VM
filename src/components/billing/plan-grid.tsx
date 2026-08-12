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
  return `grid grid-cols-1 gap-5 md:grid-cols-2 ${
    planCount >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
  }`;
}

function PlanBadge({ plan }: { plan: PlanDefinition }) {
  if (plan.tier === "growth") {
    return (
      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        <Badge className="bg-brand-green px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white shadow-sm hover:bg-brand-green">
          <Sparkles className="mr-1 h-3 w-3" />
          Most Popular
        </Badge>
      </div>
    );
  }

  if (plan.tier === "pro") {
    return (
      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        <Badge className="bg-brand-gold px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-amber-950 shadow-sm hover:bg-brand-gold">
          <Crown className="mr-1 h-3 w-3" />
          Premium
        </Badge>
      </div>
    );
  }

  return null;
}

function shortPlanName(plan: PlanDefinition): string {
  return plan.tier.charAt(0).toUpperCase() + plan.tier.slice(1);
}

function FeatureList({ plan }: { plan: PlanDefinition }) {
  return (
    <ul className="space-y-2.5">
      {getPlanFeatureItems(plan).map((feature) => (
        <li key={feature.text} className="flex items-start gap-2 text-sm">
          <Check aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-green" />
          <span className="text-foreground/90">{feature.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function PricingPlanGrid({ plans }: { plans: PlanDefinition[] }) {
  return (
    <div className={gridClassName(plans.length)}>
      {plans.map((plan) => {
        const highlighted = plan.tier === "growth";
        return (
          <Card
            key={`${plan.area}-${plan.tier}`}
            className={`relative flex flex-col transition-shadow ${
              highlighted ? "border-brand-green shadow-md" : "border-border/60 hover:shadow-sm"
            }`}
          >
            <PlanBadge plan={plan} />
            <CardHeader className="pb-2 pt-6">
              <CardTitle className="font-display text-base font-semibold">
                {shortPlanName(plan)}
              </CardTitle>
              <div className="flex items-baseline gap-1 pt-1">
                <span className="font-display text-3xl font-bold tracking-tight">
                  {formatPlanPrice(plan.priceCents)}
                </span>
                <span className="text-sm text-muted-foreground">/ 30 days</span>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <FeatureList plan={plan} />
              <div className="mt-6 pt-2">
                <Button
                  asChild
                  className="w-full gap-2"
                  variant={highlighted ? "default" : "outline"}
                >
                  <Link href={getPlanCheckoutHref(plan)}>
                    Choose {shortPlanName(plan)}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function BillingPlanGrid({ plans }: { plans: PlanDefinition[] }) {
  return (
    <div className={gridClassName(plans.length)}>
      {plans.map((plan) => {
        const highlighted = plan.tier === "growth";
        return (
          <Card
            key={`${plan.area}-${plan.tier}`}
            className={`relative flex flex-col transition-shadow ${
              highlighted ? "border-brand-green shadow-md" : "border-border/60 hover:shadow-sm"
            }`}
          >
            <PlanBadge plan={plan} />
            <CardHeader className="pb-2 pt-6 text-center">
              <CardTitle className="font-display text-base font-semibold">
                {shortPlanName(plan)}
              </CardTitle>
              <div className="flex items-baseline justify-center gap-1 pt-1">
                <span className="font-display text-3xl font-bold tracking-tight">
                  {formatPlanPrice(plan.priceCents)}
                </span>
                <span className="text-sm text-muted-foreground">/ 30 days</span>
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col">
              <div className="mb-6 flex-1">
                <FeatureList plan={plan} />
              </div>

              <SubscribeButton
                planId={getPlanCheckoutId(plan)}
                planName={plan.name}
                priceCents={plan.priceCents}
                isPopular={highlighted}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
