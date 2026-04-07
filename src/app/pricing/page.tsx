import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { FREE_POST_CONFIG, getActivePlansByArea } from "@/lib/constants/pricing";
import { PricingPlanGrid } from "@/components/billing/plan-grid";

export const metadata = {
  title: "Pricing",
  description:
    "Choose the plan that fits your promotion, visibility, and growth goals on VerifyMzansi. Free and premium options for products, businesses, and campaigns.",
};

export default function PricingPage() {
  const { marketPlans, businessPlans, promotionPlans } = getActivePlansByArea();

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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />

      <main id="main-content" className="flex-1 scroll-mt-24">
        <div className="container-page py-4 space-y-4">
          <PageHeader
            title="Pricing"
            description={`${FREE_POST_CONFIG.maxAllowed} free posts per area, each with ${FREE_POST_CONFIG.maxPhotos} photos, ${FREE_POST_CONFIG.maxVideos} ${FREE_POST_CONFIG.maxVideos === 1 ? "video" : "videos"}, and ${FREE_POST_CONFIG.durationDays} days visibility. Upgrade for more visibility and trust badges.`}
            breadcrumbs={[{ label: "Pricing" }]}
          />

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
              <PricingPlanGrid plans={marketPlans} />
            </TabsContent>

            <TabsContent value="business" className="mt-0">
              <PricingPlanGrid plans={businessPlans} />
            </TabsContent>

            {promotionPlans.length > 0 && (
              <TabsContent value="promotions" className="mt-0">
                <PricingPlanGrid plans={promotionPlans} />
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
