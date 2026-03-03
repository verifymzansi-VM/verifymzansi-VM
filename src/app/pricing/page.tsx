import { Check, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { PLANS, FREE_POST_CONFIG, type PlanDefinition } from "@/lib/constants/pricing";

export const metadata = {
  title: "Pricing | VerifyMzansi",
  description:
    "Choose the plan that fits your selling needs on VerifyMzansi. Free and premium options for Mzansi Market, Mall Shops, and Business Ads.",
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
  const marketPlans = PLANS.filter((p: PlanDefinition) => p.area === "MZANSI_MARKET");
  const businessPlans = PLANS.filter((p: PlanDefinition) => p.area === "MZANSI_BUSINESS");

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex-1">
        <div className="container-page py-10 space-y-12">
          <PageHeader
            title="Pricing"
            description={`Get 1 free post per area — ${FREE_POST_CONFIG.maxPhotos} photos, ${FREE_POST_CONFIG.maxVideos} video, visible for ${FREE_POST_CONFIG.durationDays} days. No credit card required. Then choose the plan that fits your selling needs. All plans include verification and trust badges.`}
            breadcrumbs={[{ label: "Pricing" }]}
          />

          {/* Mzansi Market Plans */}
          <section className="space-y-6">
            <div className="flex items-center gap-2">
              <Badge className="bg-brand-green text-white">Mzansi Market</Badge>
              <span className="text-sm text-muted-foreground">Classified ads</span>
            </div>
            <PlanGrid plans={marketPlans} />
          </section>

          {/* Mzansi Business Plans */}
          <section className="space-y-6">
            <div className="flex items-center gap-2">
              <Badge className="bg-brand-blue text-white">Mzansi Business</Badge>
              <span className="text-sm text-muted-foreground">
                Mall shops, storefronts &amp; business profiles
              </span>
            </div>
            <PlanGrid plans={businessPlans} />
          </section>

          {/* FAQ */}
          <div className="text-center py-8">
            <p className="text-muted-foreground">
              Have questions?{" "}
              <a href="mailto:hello@verifymzansi.co.za" className="text-brand-green underline">
                Contact us
              </a>
            </p>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
