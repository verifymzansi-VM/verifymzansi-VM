import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PlanDefinition } from "@/lib/constants/pricing";
import type { ReactNode } from "react";

type PlanGridComponent = (props: { plans: PlanDefinition[] }) => ReactNode;

export function PlanTabs({
  marketPlans,
  businessPlans,
  promotionPlans,
  PlanGrid,
  hideEmptyPromotionPlans = false,
}: {
  marketPlans: PlanDefinition[];
  businessPlans: PlanDefinition[];
  promotionPlans: PlanDefinition[];
  PlanGrid: PlanGridComponent;
  hideEmptyPromotionPlans?: boolean;
}) {
  return (
    <Tabs defaultValue="market" className="max-w-5xl mx-auto">
      <div className="flex justify-center mb-3">
        <TabsList className="grid h-12 w-full max-w-3xl grid-cols-3 rounded-full bg-muted/50 p-1">
          <TabsTrigger
            value="market"
            className="h-11 rounded-full text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
          >
            <span className="hidden sm:inline">Mzansi </span>Market
          </TabsTrigger>
          <TabsTrigger
            value="business"
            className="h-11 rounded-full text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
          >
            <span className="hidden sm:inline">Mzansi </span>Business
          </TabsTrigger>
          <TabsTrigger
            value="promotions"
            className="h-11 rounded-full text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
          >
            <span className="hidden sm:inline">Tourism & </span>Events
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="market" className="mt-0">
        <PlanGrid plans={marketPlans} />
      </TabsContent>

      <TabsContent value="business" className="mt-0">
        <PlanGrid plans={businessPlans} />
      </TabsContent>

      {(!hideEmptyPromotionPlans || promotionPlans.length > 0) && (
        <TabsContent value="promotions" className="mt-0">
          <PlanGrid plans={promotionPlans} />
        </TabsContent>
      )}
    </Tabs>
  );
}
