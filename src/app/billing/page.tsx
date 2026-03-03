import { Check, X, Crown, Sparkles, Gift, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PLANS, FREE_POST_CONFIG, type PlanDefinition } from "@/lib/constants/pricing";
import { SubscribeButton } from "@/components/billing/subscribe-button";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata = {
  title: "Pricing & Plans | VerifyMzansi",
};

export default function BillingPage() {
  // Group plans by area
  const marketPlans = PLANS.filter((p: PlanDefinition) => p.area === "MZANSI_MARKET");
  const businessPlans = PLANS.filter((p: PlanDefinition) => p.area === "MZANSI_BUSINESS");
  const promotionPlans = PLANS.filter((p: PlanDefinition) => p.area === "PROMOTIONS_EVENTS");

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main className="flex-1 bg-background">
        <div className="container-page py-12 space-y-16">
          <div className="text-center max-w-3xl mx-auto space-y-4">
            <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight">
              Simple, transparent pricing
            </h1>
            <p className="text-xl text-muted-foreground">
              Choose the perfect plan for your selling needs. Every plan includes trust badges and
              verification.
            </p>
          </div>

          {/* Free Post Banner */}
          <div className="max-w-4xl mx-auto">
            <Card className="border-brand-green/30 bg-gradient-to-br from-brand-green/10 via-background to-brand-green/5 overflow-hidden">
              <div className="flex flex-col sm:flex-row items-center justify-between p-6 sm:p-8 gap-6 text-center sm:text-left">
                <div className="space-y-2">
                  <Badge className="bg-brand-green/20 text-brand-green hover:bg-brand-green/20 mb-2">
                    <Gift className="w-3 h-3 mr-1 inline-block" /> New Sellers
                  </Badge>
                  <h2 className="font-display text-2xl sm:text-3xl font-bold">
                    1 Free Post per area — {FREE_POST_CONFIG.durationDays} days
                  </h2>
                  <p className="text-muted-foreground text-lg">
                    {FREE_POST_CONFIG.maxPhotos} photos &bull; {FREE_POST_CONFIG.maxVideos} video
                    &bull; Full verification badge. No credit card required.
                  </p>
                </div>
                <Button
                  asChild
                  size="lg"
                  className="bg-brand-green hover:bg-brand-green/90 text-white font-semibold shadow-lg whitespace-nowrap"
                >
                  <Link href="/register">
                    Get Started Free <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </Card>
          </div>

          <Tabs defaultValue="market" className="max-w-5xl mx-auto">
            <div className="flex justify-center mb-8">
              <TabsList className="grid w-full max-w-3xl grid-cols-3 p-1 h-14 bg-muted/50 rounded-full">
                <TabsTrigger
                  value="market"
                  className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Mzansi Market
                </TabsTrigger>
                <TabsTrigger
                  value="business"
                  className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Mzansi Business
                </TabsTrigger>
                <TabsTrigger
                  value="promotions"
                  className="rounded-full data-[state=active]:bg-background data-[state=active]:shadow-sm"
                >
                  Promotions & Events
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="market" className="mt-0">
              <PlanGrid plans={marketPlans} />
            </TabsContent>

            <TabsContent value="business" className="mt-0">
              <PlanGrid plans={businessPlans} />
            </TabsContent>

            <TabsContent value="promotions" className="mt-0">
              <PlanGrid plans={promotionPlans} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
      <Footer />
    </div>
  );
}

interface PlanGridProps {
  plans: PlanDefinition[];
}

function PlanGrid({ plans }: PlanGridProps) {
  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-2 ${plans.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-8`}
    >
      {plans.map((plan: PlanDefinition) => {
        const isPopular = plan.tier === "growth";
        const isPremium = plan.tier === "pro";
        const priceRands = plan.priceCents / 100;

        return (
          <Card
            key={`${plan.area}-${plan.tier}`}
            className={`relative flex flex-col ${
              isPopular
                ? "border-brand-green shadow-xl ring-1 ring-brand-green/20 scale-105 z-10 bg-background"
                : "border-border/50 shadow-sm"
            }`}
          >
            {isPopular && (
              <div className="absolute -top-4 w-full flex justify-center">
                <Badge className="bg-brand-green text-white hover:bg-brand-green px-3 py-1 text-xs font-semibold uppercase tracking-wider">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Most Popular
                </Badge>
              </div>
            )}
            {isPremium && (
              <div className="absolute -top-4 w-full flex justify-center">
                <Badge className="bg-brand-gold text-amber-950 hover:bg-brand-gold px-3 py-1 text-xs font-semibold uppercase tracking-wider">
                  <Crown className="h-3 w-3 mr-1" />
                  Premium
                </Badge>
              </div>
            )}

            <CardHeader className="text-center pb-6 pt-8">
              <CardTitle className="font-display text-xl capitalize text-muted-foreground font-medium">
                {plan.tier}
              </CardTitle>
              <div className="mt-4 flex items-baseline justify-center gap-1">
                <span className="text-3xl font-bold font-display">R{priceRands}</span>
                <span className="text-sm text-muted-foreground font-medium">/ 30 days</span>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col flex-1">
              <ul className="space-y-4 flex-1 mb-8">
                {plan.features.maxListings !== undefined && (
                  <FeatureItem included text={`${plan.features.maxListings} listings`} />
                )}
                {plan.features.maxStorefronts !== undefined && (
                  <FeatureItem included text={`${plan.features.maxStorefronts} storefronts`} />
                )}
                {plan.features.maxProfiles !== undefined && (
                  <FeatureItem included text={`${plan.features.maxProfiles} profiles`} />
                )}
                {plan.features.maxBusinesses !== undefined && (
                  <FeatureItem included text={`${plan.features.maxBusinesses} businesses`} />
                )}
                {plan.features.maxPromotions !== undefined && (
                  <FeatureItem included text={`${plan.features.maxPromotions} promotions`} />
                )}
                <FeatureItem
                  included
                  text={`${plan.features.maxPhotos} photos per ${
                    plan.area === "MZANSI_MARKET"
                      ? "listing"
                      : plan.area === "MZANSI_BUSINESS"
                        ? "business"
                        : plan.area === "PROMOTIONS_EVENTS"
                          ? "promotion"
                          : plan.area === "MALL_SHOPS"
                            ? "storefront"
                            : "profile"
                  }`}
                />
                <FeatureItem
                  included={plan.features.boostAllowed}
                  text={`Boost ${
                    plan.area === "MZANSI_MARKET"
                      ? "listings"
                      : plan.area === "MZANSI_BUSINESS"
                        ? "businesses"
                        : plan.area === "PROMOTIONS_EVENTS"
                          ? "promotions"
                          : plan.area === "MALL_SHOPS"
                            ? "storefronts"
                            : "profiles"
                  }`}
                />
                <FeatureItem included={plan.features.featuredAllowed} text="Featured placement" />
                {plan.features.maxVideos !== undefined ? (
                  <FeatureItem
                    included
                    text={`${plan.features.maxVideos} video tour${plan.features.maxVideos === 1 ? "" : "s"}`}
                  />
                ) : (
                  <FeatureItem included={plan.features.videoAllowed} text="Video tours" />
                )}
              </ul>

              <SubscribeButton
                area={plan.area}
                tier={plan.tier}
                priceCents={plan.priceCents}
                isPopular={isPopular}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function FeatureItem({ included, text }: { included: boolean; text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      {included ? (
        <Check className="h-5 w-5 text-brand-green flex-shrink-0" />
      ) : (
        <X className="h-5 w-5 text-muted-foreground/30 flex-shrink-0" />
      )}
      <span className={included ? "font-medium text-foreground" : "text-muted-foreground"}>
        {text}
      </span>
    </li>
  );
}
