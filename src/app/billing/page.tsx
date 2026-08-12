import { Gift, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { FREE_POST_CONFIG, getActivePlansByArea } from "@/lib/constants/pricing";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { BillingPlanGrid } from "@/components/billing/plan-grid";
import { PlanTabs } from "@/components/billing/plan-tabs";
import { PageHeader } from "@/components/layout/page-header";

export const metadata = {
  title: "Billing & Plans",
  description:
    "View your current plan, manage billing, and upgrade your VerifyMzansi subscription.",
};

export default function BillingPage() {
  const { marketPlans, businessPlans, promotionPlans } = getActivePlansByArea();
  const freePostCount = Number(FREE_POST_CONFIG.maxAllowed);

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1 bg-background scroll-mt-24">
        <div className="container-page py-6 space-y-6">
          <PageHeader
            centered
            title="Choose your plan"
            description="Start free, then upgrade only when you want stronger placement and reach."
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
                  {freePostCount} free {freePostCount === 1 ? "post" : "posts"} per area —{" "}
                  <span className="opacity-80">
                    {FREE_POST_CONFIG.maxPhotos} photos, {FREE_POST_CONFIG.maxVideos} video,{" "}
                    {FREE_POST_CONFIG.durationDays} days
                  </span>
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

          <PlanTabs
            marketPlans={marketPlans}
            businessPlans={businessPlans}
            promotionPlans={promotionPlans}
            PlanGrid={BillingPlanGrid}
          />

          <p className="mx-auto max-w-2xl text-center text-xs text-muted-foreground">
            Plans run for 30 days and do not auto-renew unless checkout clearly states recurring
            billing is enabled. Cancellation stops the next renewal and does not remove the current
            30-day entitlement. Paid visibility does not bypass moderation.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
