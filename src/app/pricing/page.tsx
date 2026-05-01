import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { FREE_POST_CONFIG, getActivePlansByArea } from "@/lib/constants/pricing";
import { PricingPlanGrid } from "@/components/billing/plan-grid";
import { PlanTabs } from "@/components/billing/plan-tabs";
import { getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "Pricing",
  description:
    "Choose the plan that fits your promotion, visibility, and growth goals on VerifyMzansi. Free and premium options for products, businesses, and campaigns.",
};

export default function PricingPage() {
  const { marketPlans, businessPlans, promotionPlans } = getActivePlansByArea();
  const trustConfig = getTrustPublicConfig();
  const freePostCount = Number(FREE_POST_CONFIG.maxAllowed);
  const summaryPoints = [
    `${freePostCount} free ${freePostCount === 1 ? "post" : "posts"} per area`,
    `${FREE_POST_CONFIG.maxPhotos} photos + ${FREE_POST_CONFIG.maxVideos} video included`,
    "Upgrade for placement and visibility",
  ] as const;

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
            description="Start free. Upgrade when you need stronger placement, boosts, or campaign visibility."
            breadcrumbs={[{ label: "Pricing" }]}
          />

          <div className="grid gap-3 md:grid-cols-3">
            {summaryPoints.map((point) => (
              <div
                key={point}
                className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
              >
                {point}
              </div>
            ))}
          </div>

          <PlanTabs
            marketPlans={marketPlans}
            businessPlans={businessPlans}
            promotionPlans={promotionPlans}
            PlanGrid={PricingPlanGrid}
            hideEmptyPromotionPlans
          />

          <section className="mx-auto grid max-w-5xl gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground md:grid-cols-2">
            <div>
              <h2 className="font-display text-base font-semibold text-foreground">
                Payment transparency
              </h2>
              <p className="mt-1">
                Paid features are processed in ZAR through secure hosted checkout.{" "}
                {trustConfig.ozowMerchantName
                  ? `Your bank or Ozow record may show ${trustConfig.ozowMerchantName}.`
                  : "Your bank record should identify VerifyMzansi or its checkout provider."}
              </p>
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-foreground">
                Moderation and refunds
              </h2>
              <p className="mt-1">
                Paid visibility does not bypass moderation. If paid content is rejected, support can
                review correction, credit, or refund options.
              </p>
              {trustConfig.vatStatus && <p className="mt-2">VAT status: {trustConfig.vatStatus}</p>}
            </div>
          </section>

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
