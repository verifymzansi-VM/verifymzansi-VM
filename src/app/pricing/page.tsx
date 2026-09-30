import { CalendarDays, LockKeyhole, ReceiptText, ShieldCheck } from "lucide-react";

import { TrialPolicy } from "@/components/billing/trial-policy";
import { BillingFaq } from "@/components/billing/billing-faq";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BrandSurface } from "@/components/brand";
import { RetailPricing } from "@/components/billing/retail-pricing";
import { EnterprisePricing } from "@/components/billing/enterprise-pricing";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { getCommercialSettings } from "@/lib/commercial/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTrustPublicConfig } from "@/lib/trust-public-config";

const HERO_POINTS = [
  { icon: ReceiptText, label: "Never renews" },
  { icon: LockKeyhole, label: "Secure Ozow checkout" },
  { icon: CalendarDays, label: "Events always free" },
] as const;

export const metadata = {
  title: "Pricing",
  description:
    "Simple VerifyMzansi pricing: R50 for 30 days, R250 for 6 months, R450 for 12 months. Events are free. Bulk and organisation programmes on request.",
};

export const revalidate = 300;

async function loadSettings() {
  try {
    return await getCommercialSettings(createAdminClient() as never);
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const [catalog, settings] = await Promise.all([getCommercialCatalog(), loadSettings()]);
  const trustConfig = getTrustPublicConfig();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "VerifyMzansi Pricing",
    url: `${process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"}/pricing`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: catalog.retail.map((offer, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Offer",
          name: `VerifyMzansi listing — ${offer.label}`,
          priceCurrency: "ZAR",
          price: (offer.priceCents / 100).toFixed(2),
          description: `One active posting slot for ${offer.label.toLowerCase()} in Mzansi Market, Mzansi Business or Tourism`,
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
        <BrandSurface as="section" aria-labelledby="pricing-title">
          <div className="container-page relative grid items-center gap-8 pb-10 pt-6 sm:pt-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14 lg:pb-14 lg:pt-10">
            <div className="min-w-0">
              <Breadcrumbs items={[{ label: "Pricing" }]} tone="inverse" />
              <h1
                id="pricing-title"
                className="mt-4 font-display text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-5xl"
              >
                Start free. <span className="text-brand-gold-300">Then one simple price.</span>
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
                Your first post is free. After that, the same price in every section.
              </p>
              <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-white/90">
                {HERO_POINTS.map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gold-300/15 text-brand-gold-300">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {label}
                  </li>
                ))}
              </ul>
            </div>
            <TrialPolicy trials={settings?.trials} className="w-full lg:ml-auto lg:max-w-md" />
          </div>
        </BrandSurface>

        <section
          id="plans"
          aria-labelledby="plans-title"
          className="container-page scroll-mt-28 py-10 sm:py-14"
        >
          <div className="mx-auto mb-7 max-w-2xl text-center">
            <h2 id="plans-title" className="section-title">
              Plans
            </h2>
            <p className="section-lede mx-auto">One posting slot, paid once.</p>
          </div>
          <RetailPricing offers={catalog.retail} trialDays={settings?.trials} />
        </section>

        <section aria-label="Paying safely" className="container-page pb-10 sm:pb-14">
          <ul className="mx-auto grid max-w-6xl gap-4 rounded-3xl bg-muted/60 p-4 text-sm sm:grid-cols-3 sm:p-5">
            {[
              {
                icon: LockKeyhole,
                title: "Secure Ozow checkout",
                text: "Pay on Ozow's hosted page.",
              },
              {
                icon: ReceiptText,
                title: "Clear rand pricing",
                text: trustConfig.ozowMerchantName
                  ? `Shows as ${trustConfig.ozowMerchantName}.`
                  : "Prices shown in ZAR.",
              },
              {
                icon: ShieldCheck,
                title: "Still moderated",
                text: "Support helps if a post is rejected.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-center gap-3">
                <span className="icon-tile area-market-tile">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <p className="leading-5 text-muted-foreground">
                  <span className="block font-semibold text-foreground">{title}</span>
                  {text}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <div className="container-page pb-12 sm:pb-16">
          <EnterprisePricing
            plans={catalog.enterprise}
            checkoutEnabled={settings?.features.enterpriseCheckout ?? true}
          />
        </div>

        <div className="border-t border-border/60 bg-card/50">
          <div className="container-page py-12 sm:py-16">
            <BillingFaq
              trials={settings?.trials}
              merchantName={trustConfig.ozowMerchantName}
              vatStatus={trustConfig.vatStatus}
            />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
