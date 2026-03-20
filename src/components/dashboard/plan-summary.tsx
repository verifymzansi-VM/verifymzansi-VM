import Link from "next/link";
import { CreditCard, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground flex-shrink-0">
            <CreditCard className="h-4 w-4" />
            Your Plan
          </div>

          <div className="flex flex-1 flex-wrap gap-x-6 gap-y-2">
            {plans.map((plan) => (
              <div key={plan.area} className="text-sm">
                <span className="font-medium">{plan.areaLabel}:</span>{" "}
                <span className="text-muted-foreground">{plan.tierLabel}</span>
                {plan.maxAllowed > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({plan.currentCount}/{plan.maxAllowed === -1 ? "∞" : plan.maxAllowed} used)
                  </span>
                )}
              </div>
            ))}
          </div>

          <Button asChild variant="outline" size="sm" className="gap-1 flex-shrink-0">
            <Link href="/billing">
              Upgrade
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
