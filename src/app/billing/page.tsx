import { Gift, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FREE_POST_CONFIG, getActivePlansByArea } from "@/lib/constants/pricing";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { BillingPlanGrid } from "@/components/billing/plan-grid";

export const metadata = {
  title: "Pricing",
  description:
    "View your current plan, manage billing, and upgrade your VerifyMzansi subscription.",
};

export default function BillingPage() {
  const { marketPlans, businessPlans, promotionPlans } = getActivePlansByArea();

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1 bg-background scroll-mt-24">
        <div className="container-page py-4 space-y-4">
          <div className="text-center max-w-3xl mx-auto space-y-1">
            <h1 className="text-lg sm:text-xl md:text-2xl font-display font-bold tracking-tight">
              Simple, transparent pricing
            </h1>
            <p className="text-sm text-muted-foreground">
              All plans include trust badges and verification.
            </p>
          </div>

          {/* Free Post Banner */}
          <div className="max-w-4xl mx-auto">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-2 px-4 rounded-lg bg-brand-green/10 border border-brand-green/20">
              <div className="flex items-center gap-2">
                <Badge className="bg-brand-green/20 text-brand-green hover:bg-brand-green/20">
                  <Gift className="w-3 h-3 mr-1 inline-block" /> Free
                </Badge>
                <span className="text-xs font-medium">
                  {FREE_POST_CONFIG.maxAllowed} free posts per area — {FREE_POST_CONFIG.maxPhotos}{" "}
                  photos, {FREE_POST_CONFIG.maxVideos} video, {FREE_POST_CONFIG.durationDays} days
                  each
                </span>
              </div>
              <Button
                asChild
                size="sm"
                className="h-11 bg-brand-green text-white font-semibold shrink-0 hover:bg-brand-green/90"
              >
                <Link href="/post/create">
                  Choose Your Free Post <ArrowRight className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            </div>
          </div>

          <Tabs defaultValue="market" className="max-w-5xl mx-auto">
            <div className="flex justify-center mb-3">
              <TabsList className="grid w-full max-w-3xl grid-cols-3 p-1 h-12 bg-muted/50 rounded-full">
                <TabsTrigger
                  value="market"
                  className="h-11 rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs sm:text-sm"
                >
                  <span className="hidden sm:inline">Mzansi </span>Market
                </TabsTrigger>
                <TabsTrigger
                  value="business"
                  className="h-11 rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs sm:text-sm"
                >
                  <span className="hidden sm:inline">Mzansi </span>Business
                </TabsTrigger>
                <TabsTrigger
                  value="promotions"
                  className="h-11 rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm text-xs sm:text-sm"
                >
                  <span className="hidden sm:inline">Tourism & </span>Events
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="market" className="mt-0">
              <BillingPlanGrid plans={marketPlans} />
            </TabsContent>

            <TabsContent value="business" className="mt-0">
              <BillingPlanGrid plans={businessPlans} />
            </TabsContent>

            <TabsContent value="promotions" className="mt-0">
              <BillingPlanGrid plans={promotionPlans} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />
    </div>
  );
}
