import { TrialPolicy } from "@/components/billing/trial-policy";
import { BillingFaq } from "@/components/billing/billing-faq";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { getCommercialSettings } from "@/lib/commercial/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { RetailPricing } from "@/components/billing/retail-pricing";
import { PageHeader } from "@/components/layout/page-header";
import { getTrustPublicConfig } from "@/lib/trust-public-config";

export const metadata = {
  title: "Billing & Plans",
  description:
    "View your current plan, manage billing, and upgrade your VerifyMzansi subscription.",
};

export const dynamic = "force-dynamic";

async function loadTrialSettings() {
  try {
    return (await getCommercialSettings(createAdminClient() as never)).trials;
  } catch {
    return undefined;
  }
}

export default async function BillingPage() {
  const [catalog, trials] = await Promise.all([getCommercialCatalog(), loadTrialSettings()]);
  const trustConfig = getTrustPublicConfig();

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1 scroll-mt-24 bg-background">
        <section className="border-b border-border/60 bg-hero-mesh">
          <div className="container-page py-6 sm:py-8">
            <PageHeader
              title="Choose your plan"
              description="One reusable posting slot, paid once."
              breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Billing" }]}
            />
          </div>
        </section>

        <div className="container-page space-y-10 py-8 sm:py-10">
          <TrialPolicy trials={trials} variant="banner" />

          <RetailPricing offers={catalog.retail} trialDays={trials} />

          <BillingFaq
            trials={trials}
            merchantName={trustConfig.ozowMerchantName}
            vatStatus={trustConfig.vatStatus}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
}
