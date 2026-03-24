import Link from "next/link";
import { CreditCard, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface PlanInfo {
  area: string;
  areaLabel: string;
  tierLabel: string;
  currentCount: number;
  maxAllowed: number;
}

interface PlanSummaryProps {
  plans: PlanInfo[];
}

export function PlanSummary({ plans }: PlanSummaryProps) {
  if (plans.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <CreditCard className="h-4 w-4" />
          Plan and limits
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          See what each paid area includes and how much of it you are currently using.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {plans.map((plan) => (
            <div
              key={plan.area}
              className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{plan.areaLabel}</p>
                  <p className="text-muted-foreground">{plan.tierLabel}</p>
                </div>
                {plan.maxAllowed > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {plan.currentCount}/{plan.maxAllowed === -1 ? "∞" : plan.maxAllowed} used
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <Button asChild variant="outline" size="sm" className="gap-1">
          <Link href="/billing">
            Manage Billing
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
