import { Check, Sparkles, ArrowRight, Megaphone, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import {
  FREE_POST_CONFIG,
  isActiveMarketplaceArea,
  PLANS,
  type PlanDefinition,
} from "@/lib/constants/pricing";

export const metadata = {
  title: "Pricing",
  description:
    "Choose the plan that fits your selling and advertising needs on VerifyMzansi. Free and premium options for Mzansi Market, Mzansi Business, and Promotions & Events.",
};

function featureList(plan: PlanDefinition): string[] {
  const f = plan.features;
  const items: string[] = [];
  if (f.maxListings !== undefined) items.push(`Up to ${f.maxListings} listings`);
  if (f.maxStorefronts !== undefined)
    items.push(`${f.maxStorefronts} storefront${f.maxStorefronts === 1 ? "" : "s"}`);
  if (f.maxProfiles !== undefined)
    items.push(`${f.maxProfiles} business profile${f.maxProfiles === 1 ? "" : "s"}`);
  if (f.maxBusinesses !== undefined)
    items.push(`${f.maxBusinesses} business${f.maxBusinesses === 1 ? "" : "es"}`);
  items.push(`${f.maxPhotos} photos per post`);
  items.push(`${f.maxPostsPerMonth} posts / 30 days`);
  if (f.videoAllowed) items.push("Video uploads");
  if (f.boostAllowed) items.push("Boost listings");
  if (f.featuredAllowed) items.push("Featured placement");
  if (f.urgentAllowed) items.push("Urgent badge");
  if (f.coverVideoAllowed) items.push("Cover video");
  return items;
}

function PlanGrid({ plans }: { plans: PlanDefinition[] }) {
  return (
    <div
      className={`grid grid-cols-1 md:grid-cols-2 ${plans.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-6`}
    >
      {plans.map((plan) => (
        <Card
          key={`${plan.area}-${plan.tier}`}
          className={plan.tier === "pro" ? "border-brand-green shadow-lg relative" : ""}
        >
          {plan.tier === "pro" && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-brand-green text-white gap-1">
                <Sparkles className="h-3 w-3" />
                Best Value
              </Badge>
            </div>
          )}
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">{plan.name}</CardTitle>
            <div className="pt-1">
              {plan.priceCents === 0 ? (
                <span className="text-3xl font-bold font-display">Free</span>
              ) : (
                <div>
                  <span className="text-3xl font-bold font-display">
                    R{(plan.priceCents / 100).toLocaleString("en-ZA")}
                  </span>
                  <span className="text-muted-foreground text-sm">/ 30 days</span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {featureList(plan).map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-brand-green flex-shrink-0 mt-0.5" />
                  {feature}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <Button
                asChild
                className="w-full gap-2"
                variant={plan.tier === "pro" ? "default" : "outline"}
              >
                <Link href="/register">
                  {plan.priceCents === 0 ? "Get Started Free" : "Choose Plan"}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function PricingPage() {
  const activePlans = PLANS.filter((plan: PlanDefinition) => isActiveMarketplaceArea(plan.area));
  const marketPlans = activePlans.filter((p: PlanDefinition) => p.area === "MZANSI_MARKET");
  const businessPlans = activePlans.filter((p: PlanDefinition) => p.area === "MZANSI_BUSINESS");
  const promotionPlans = activePlans.filter((p: PlanDefinition) => p.area === "PROMOTIONS_EVENTS");

  const allPlans = [...marketPlans, ...businessPlans, ...promotionPlans];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "VerifyMzansi Pricing",
    url: `${process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"}/pricing`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: allPlans.map((plan, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Offer",
          name: `${plan.area.replace(/_/g, " ")} — ${plan.tier}`,
          priceCurrency: "ZAR",
          price: (plan.priceCents / 100).toFixed(2),
          description: `VerifyMzansi ${plan.tier} plan for ${plan.area.replace(/_/g, " ")}`,
          seller: { "@type": "Organization", name: "VerifyMzansi" },
        },
      })),
    },
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="flex-1">
        <div className="container-page py-4 space-y-4">
          <PageHeader
            title="Pricing"
            description={`1 free post per area with ${FREE_POST_CONFIG.maxPhotos} photos and ${FREE_POST_CONFIG.maxVideos} video. All plans include verification, trust badges, and support for time-sensitive Promotions & Events campaigns.`}
            breadcrumbs={[{ label: "Pricing" }]}
          />

          <Card className="max-w-5xl mx-auto border-red-200/70 bg-gradient-to-br from-red-50 via-white to-amber-50 dark:border-red-900/60 dark:from-red-950/30 dark:via-background dark:to-amber-950/20">
            <CardContent className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)] lg:items-center">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-red-700 px-3 py-1 text-xs font-medium text-white">
                  <Megaphone className="h-3.5 w-3.5" />
                  Promotions & Events plans
                </div>
                <div className="space-y-2">
                  <h2 className="font-display text-xl font-semibold">
                    Built for campaigns that need urgency
                  </h2>
                  <p className="text-sm text-muted-foreground sm:text-base">
                    Use Promotions & Events when you need to advertise a short-run offer, opening
                    special, launch, or event without changing your core business profile.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                    <Zap className="h-4 w-4 text-red-600" />
                    <p className="mt-2 text-sm font-medium">Short-run campaigns</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                    <ShieldCheck className="h-4 w-4 text-red-600" />
                    <p className="mt-2 text-sm font-medium">Verified trust</p>
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-background/80 p-3">
                    <Megaphone className="h-4 w-4 text-red-600" />
                    <p className="mt-2 text-sm font-medium">Boosted visibility</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 lg:justify-self-end lg:min-w-56">
                <Button asChild className="gap-2 bg-red-700 hover:bg-red-800 text-white">
                  <Link href="/post/create-promotion">
                    Post in Promotions & Events
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="gap-2">
                  <Link href="/promotions">
                    Browse Promotions & Events
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="market" className="max-w-5xl mx-auto">
            <div className="flex justify-center mb-3">
              <TabsList className="grid w-full max-w-3xl grid-cols-3 p-1 h-9 bg-muted/50 rounded-full">
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

            {promotionPlans.length > 0 && (
              <TabsContent value="promotions" className="mt-0">
                <PlanGrid plans={promotionPlans} />
              </TabsContent>
            )}
          </Tabs>

          <p className="text-center text-sm text-muted-foreground">
            Have questions?{" "}
            <a
              href="mailto:hello@verifymzansi.com"
              className="text-brand-green underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              Contact us
            </a>
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
