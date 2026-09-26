import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";
import { TrialPolicy } from "@/components/billing/trial-policy";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { CreditCard } from "lucide-react";
import { RetailPricing } from "@/components/billing/retail-pricing";
import { EnterprisePricing } from "@/components/billing/enterprise-pricing";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { getCommercialSettings } from "@/lib/commercial/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTrustPublicConfig } from "@/lib/trust-public-config";
import { HELLO_CONTACT_EMAIL } from "@/lib/contact-email";

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
        {/* ── Hero band ─────────────────────────────────── */}
        <section className="border-b border-warm-200/70 bg-hero-mesh dark:border-warm-800/60">
          <div className="container-page py-6 sm:py-8">
            <PageHeader
              title="Pricing"
              description="One simple price in every section. R50 for 30 days, R250 for 6 months, R450 for 12 months — and events are free."
              breadcrumbs={[{ label: "Pricing" }]}
            />
          </div>
        </section>

        <div className="container-page space-y-8 py-8 sm:py-10">
          <RetailPricing offers={catalog.retail} trialDays={settings?.trials} />

          <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
            Plans are prepaid for a fixed period and never renew automatically. Nothing is visible
            until payment is confirmed. When a plan ends, your posts stay saved in your dashboard
            and can be reactivated.
          </p>

          <TrialPolicy trials={settings?.trials} />

          <EnterprisePricing
            plans={catalog.enterprise}
            checkoutEnabled={settings?.features.enterpriseCheckout ?? true}
          />

          <section className="mx-auto grid max-w-5xl gap-4 md:grid-cols-2">
            <div className="surface-card p-5 transition-shadow duration-200 hover:elev-sm sm:p-6">
              <div className="flex items-center gap-3">
                <span className="icon-tile bg-brand-green/10 text-brand-green dark:text-brand-green-300">
                  <CreditCard className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <h2 className="font-display text-base font-semibold text-foreground">
                  Payment transparency
                </h2>
              </div>
              <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
                Paid features are processed in ZAR through secure hosted checkout.{" "}
                {trustConfig.ozowMerchantName
                  ? `Your bank or Ozow record may show ${trustConfig.ozowMerchantName}.`
                  : "Your bank record should identify VerifyMzansi or its checkout provider."}
              </p>
            </div>
            <div className="surface-card p-5 transition-shadow duration-200 hover:elev-sm sm:p-6">
              <div className="flex items-center gap-3">
                <span className="icon-tile bg-brand-green/10 text-brand-green dark:text-brand-green-300">
                  <ShieldCheck className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <h2 className="font-display text-base font-semibold text-foreground">
                  Moderation and refunds
                </h2>
              </div>
              <p className="mt-2.5 text-sm leading-6 text-muted-foreground">
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
