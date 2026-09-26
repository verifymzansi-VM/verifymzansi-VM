import { TrialPolicy } from "@/components/billing/trial-policy";
import { Gift, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { getCommercialSettings } from "@/lib/commercial/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { RetailPricing } from "@/components/billing/retail-pricing";
import { PageHeader } from "@/components/layout/page-header";

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

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1 bg-background scroll-mt-24">
        <div className="container-page py-6 space-y-6">
          <PageHeader
            centered
            title="Choose your plan"
            description="R50 for 30 days, R250 for 6 months or R450 for 12 months. Each plan is one reusable posting slot."
            className="border-0 pb-0"
          />

          {/* Free Post Banner */}
          <div className="max-w-3xl mx-auto w-full">
            <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-brand-green/20 bg-brand-green/5 px-4 py-3 dark:border-brand-green/25 dark:bg-brand-green/10 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Badge className="inline-flex items-center border-0 bg-brand-green/15 px-2 py-0.5 text-brand-green-700 dark:text-brand-green-300">
                  <Gift className="mr-1.5 h-3.5 w-3.5 shrink-0" /> Free
                </Badge>
                <span className="text-xs font-medium leading-tight text-foreground/90">
                  One introductory choice: {trials?.shortDays ?? 7} days or limited{" "}
                  {trials?.longDays ?? 30} days.
                </span>
              </div>
              <Button
                asChild
                size="default"
                className="shrink-0 bg-brand-green font-semibold text-white transition-colors hover:bg-brand-green-600"
              >
                <Link href="/post/create" className="group/btn flex items-center gap-1">
                  Start with a Free Post
                  <ArrowRight className="h-4 w-4 shrink-0 transition-transform duration-300 group-hover/btn:translate-x-1" />
                </Link>
              </Button>
            </div>
          </div>

          <RetailPricing offers={catalog.retail} trialDays={trials} />

          <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
            Plans are prepaid and never renew automatically. Buy another slot at any time to post
            more at once. Paid visibility does not bypass moderation.
          </p>

          <TrialPolicy trials={trials} />
        </div>
      </main>
      <Footer />
    </div>
  );
}
