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
  title: "Pricing",
  description:
    "View your current plan, manage billing, and upgrade your VerifyMzansi subscription.",
};

export default function BillingPage() {
  const { marketPlans, businessPlans, promotionPlans } = getActivePlansByArea();
  const freePostCount = Number(FREE_POST_CONFIG.maxAllowed);
  const summaryPoints = [
    `${freePostCount} free ${freePostCount === 1 ? "post" : "posts"} per area`,
    `${FREE_POST_CONFIG.maxPhotos} photos + ${FREE_POST_CONFIG.maxVideos} video on free publishing`,
    "Paid plans add boost, featured placement, and urgent badges",
  ] as const;

  return (
    <div className="flex min-h-screen flex-col">
      <Header isAuthenticated />
      <main id="main-content" className="flex-1 bg-background scroll-mt-24">
        <div className="container-page py-4 space-y-4">
          <PageHeader
            centered
            title="Choose your visibility plan"
            description="Start free, then upgrade only when you want stronger placement and trust-led reach."
            className="border-0 pb-0"
          />

          <div className="grid max-w-5xl gap-3 mx-auto md:grid-cols-3">
            {summaryPoints.map((point) => (
              <div
                key={point}
                className="rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm text-slate-700 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
              >
                {point}
              </div>
            ))}
          </div>

          {/* Free Post Banner */}
          <div className="max-w-4xl mx-auto">
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
        </div>
      </main>
      <Footer />
    </div>
  );
}
