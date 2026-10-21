import Link from "next/link";
import { ArrowRight, LockKeyhole, ReceiptText, Users } from "lucide-react";
import { BrandSurface } from "@/components/brand";
import { MultiListingPlans, perPostPer30DaysCents } from "@/components/billing/multi-listing-plans";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { getCommercialCatalog } from "@/lib/commercial/plans";
import { getCommercialSettings } from "@/lib/commercial/settings";
import {
  ENTERPRISE_ADMINS_INCLUDED,
  ENTERPRISE_QUOTE_ABOVE_SLOTS,
  formatPlanPrice,
} from "@/lib/constants/pricing";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "Multi-listing plans",
  description: `Keep 10 to ${ENTERPRISE_QUOTE_ABOVE_SLOTS} posts live at once on VerifyMzansi for 90 or 180 days. For dealers, agencies, shops and landlords. Pay once online; nothing renews.`,
};

export const revalidate = 300;

const STEPS = [
  {
    title: "Choose a size and a term",
    text: "Pick how many posts you want live at once, for 90 or 180 days, and pay once with Ozow.",
  },
  {
    title: "Post as usual",
    text: "Create each post from Post. Every live post uses one place in your plan, in any section.",
  },
  {
    title: "Swap stock as it sells",
    text: "Publish replacement stock within your plan's live-post and activation limits.",
  },
] as const;

async function loadCheckoutEnabled() {
  try {
    const settings = await getCommercialSettings(createAdminClient() as never);
    return settings.features.enterpriseCheckout ?? true;
  } catch {
    return true;
  }
}

/**
 * The page a dealer, agency or shop lands on from the posting flow, billing,
 * pricing and advertise pages: buy a multi-listing plan directly.
 */
export default async function MultiListingPage() {
  const [catalog, checkoutEnabled] = await Promise.all([
    getCommercialCatalog(),
    loadCheckoutEnabled(),
  ]);
  const cheapestPerPost = catalog.enterprise.length
    ? Math.min(...catalog.enterprise.map(perPostPer30DaysCents))
    : null;
  const singleFrom = catalog.retail.length
    ? catalog.retail.reduce((low, offer) => (offer.priceCents < low.priceCents ? offer : low))
    : null;
  const heroPoints = [
    { icon: ReceiptText, label: "Paid once, never renews" },
    { icon: LockKeyhole, label: "Secure Ozow checkout" },
    { icon: Users, label: `${ENTERPRISE_ADMINS_INCLUDED} administrators included` },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1">
        <BrandSurface as="section" aria-labelledby="multi-listing-title">
          <div className="container-page pb-10 pt-6 sm:pt-8 lg:pb-14">
            <Breadcrumbs
              items={[{ label: "Pricing", href: "/pricing" }, { label: "Multi-listing" }]}
              tone="inverse"
            />
            <h1
              id="multi-listing-title"
              className="mt-4 max-w-3xl font-display text-[2.2rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-5xl"
            >
              Keep your whole stock live.{" "}
              <span className="gold-shine text-brand-gold-300">One plan, many posts.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
              10 to {ENTERPRISE_QUOTE_ABOVE_SLOTS} posts live at the same time in Mzansi Market,
              Mzansi Business or Tourism & Events, for 90 or 180 days
              {cheapestPerPost !== null
                ? `, from ${formatPlanPrice(cheapestPerPost)} per post per 30 days`
                : ""}
              .
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-white/90">
              {heroPoints.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-gold-300/15 text-brand-gold-300">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </BrandSurface>

        <section
          aria-labelledby="multi-listing-plans-title"
          className="container-page py-10 sm:py-14"
        >
          <h2 id="multi-listing-plans-title" className="section-title">
            Choose your plan
          </h2>
          <p className="section-lede mb-6">
            Prices are the total for the term.
            {singleFrom
              ? ` A single post costs ${formatPlanPrice(singleFrom.priceCents)} for ${singleFrom.durationDays} days.`
              : ""}
          </p>
          <MultiListingPlans plans={catalog.enterprise} checkoutEnabled={checkoutEnabled} />
        </section>

        <section
          aria-labelledby="multi-listing-how-title"
          className="border-t border-border/60 bg-card/50"
        >
          <div className="container-page py-10 sm:py-14">
            <h2 id="multi-listing-how-title" className="section-title">
              How it works
            </h2>
            <ol className="mt-6 grid gap-4 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-2xl border border-border/70 bg-card p-5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-gold/20 font-display text-sm font-bold text-brand-gold-800 dark:text-brand-gold-300">
                    {index + 1}
                  </span>
                  <h3 className="mt-3 font-body text-base font-bold text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
            <Link
              href="/advertise#multi-listing"
              className="mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-green-700 underline-offset-4 hover:underline dark:text-brand-green-300"
            >
              Who multi-listing is for, and everything it includes
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
