import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { CreditCard, ShieldCheck } from "lucide-react";
import { getActivePlansByArea } from "@/lib/constants/pricing";
import { PricingPlanGrid } from "@/components/billing/plan-grid";
import { PlanTabs } from "@/components/billing/plan-tabs";
import { getTrustPublicConfig } from "@/lib/trust-public-config";
import { HELLO_CONTACT_EMAIL } from "@/lib/contact-email";

export const metadata = {
  title: "Pricing",
  description:
    "View VerifyMzansi pricing for marketplace listings, business profiles, tourism posts, venues, and events. Start free, then upgrade for stronger placement.",
};

export default function PricingPage() {
  const { marketPlans, businessPlans, promotionPlans } = getActivePlansByArea();
  const trustConfig = getTrustPublicConfig();
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
        {/* ── Hero band ─────────────────────────────────── */}
        <section className="border-b border-warm-200/70 bg-hero-mesh dark:border-warm-800/60">
          <div className="container-page py-6 sm:py-8">
            <PageHeader
              title="Pricing"
              description="Start free for marketplace listings, business profiles, tourism posts, venues, and events. Upgrade when you want stronger placement."
              breadcrumbs={[{ label: "Pricing" }]}
            />
          </div>
        </section>

        <div className="container-page space-y-8 py-8 sm:py-10">
          <PlanTabs
            marketPlans={marketPlans}
            businessPlans={businessPlans}
            promotionPlans={promotionPlans}
            PlanGrid={PricingPlanGrid}
            hideEmptyPromotionPlans
          />

          <section className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
                  <CreditCard className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <h2 className="font-display text-base font-semibold text-foreground">
                  Payment transparency
                </h2>
              </div>
              <p className="mt-2.5 text-sm text-muted-foreground">
                Paid features are processed in ZAR through secure hosted checkout.{" "}
                {trustConfig.ozowMerchantName
                  ? `Your bank or Ozow record may show ${trustConfig.ozowMerchantName}.`
                  : "Your bank record should identify VerifyMzansi or its checkout provider."}
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-green/10 text-brand-green">
                  <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <h2 className="font-display text-base font-semibold text-foreground">
                  Moderation and refunds
                </h2>
              </div>
              <p className="mt-2.5 text-sm text-muted-foreground">
                Paid visibility does not bypass moderation. If paid content is rejected, support can
                review correction, credit, or refund options.
              </p>
              {trustConfig.vatStatus && (
                <p className="mt-2 text-sm text-muted-foreground">
                  VAT status: {trustConfig.vatStatus}
                </p>
              )}
            </div>
          </section>

          <p className="text-center text-sm text-muted-foreground">
            Have questions?{" "}
            <a
              href={`mailto:${HELLO_CONTACT_EMAIL}`}
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
