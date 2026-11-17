import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, LockKeyhole, ReceiptText, Users } from "lucide-react";
import { BrandSurface } from "@/components/brand";
import { MultiListingPlans } from "@/components/billing/multi-listing-plans";
import { readOnlinePaymentMaxCents } from "@/lib/foundation/payment-limits";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { formatPlanPrice, RETAIL_OFFERS } from "@/lib/constants/pricing";
import {
  PACKAGE_MAX_ONLINE_SLOTS,
  PACKAGE_MIN_SLOTS,
  PACKAGE_POSTS_PER_SLOT_PER_30_DAYS,
  PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS,
} from "@/lib/billing/slot-packages";
import { readPackagesOnSale } from "@/lib/foundation/slot-package-offer";
import { SHOW_PACKAGE_TEAMS } from "@/lib/hidden-features";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Multi-listing packages",
  description: `Keep your whole stock live on VerifyMzansi: from ${PACKAGE_MIN_SLOTS} slots at ${formatPlanPrice(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per slot per 30 days, for 30, 90 or 180 days. For dealers, agencies, shops and landlords. Prepaid; does not renew automatically.`,
};

const STEPS = [
  {
    title: "Choose your slots and a term",
    text: `Type how many posts you want live at once (from ${PACKAGE_MIN_SLOTS}) and pick 30, 90 or 180 days. Pay securely with Ozow; above the most Ozow accepts in one payment, by invoice.`,
  },
  {
    title: "Post as usual",
    text: "Create each post from Post. Every live post uses one slot of your package, in any section, and is reviewed before it goes live.",
  },
  {
    title: "Swap stock as it sells",
    text: `Publish replacement stock any time, up to ${PACKAGE_POSTS_PER_SLOT_PER_30_DAYS} posts going live per slot per 30 days. All your slots end together.`,
  },
] as const;

/**
 * The page a dealer, agency or shop lands on from the posting flow, billing,
 * pricing and advertise pages: buy a Multi-listing package (roadmap P4a, the
 * owner's decisions of 14 November 2026). Hidden (not found) while packages
 * are not on sale: the owner's switch in the database, off until business
 * tools P5-P7 pass.
 */
export default async function MultiListingPage() {
  const offer = await readPackagesOnSale();
  if (!offer) notFound();
  const onlineMaxCents = await readOnlinePaymentMaxCents();
  const heroPoints = [
    { icon: ReceiptText, label: "Does not renew automatically" },
    { icon: LockKeyhole, label: "Secure Ozow checkout" },
    // Hidden until package teams work (src/lib/hidden-features.ts).
    ...(SHOW_PACKAGE_TEAMS
      ? [{ icon: Users, label: "You + 1 person (you + 4 from 50 slots)" }]
      : []),
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
              <span className="gold-shine text-brand-gold-300">One package, many posts.</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-white/75 sm:text-lg sm:leading-8">
              {`From ${PACKAGE_MIN_SLOTS} slots at ${formatPlanPrice(PACKAGE_SLOT_PRICE_CENTS_PER_30_DAYS)} per slot per 30 days, for 30, 90 or 180 days, in Mzansi Market, Mzansi Business or Tourism & Events. Each slot keeps one post live at a time.`}
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
            Choose your package
          </h2>
          <p className="section-lede mb-6">
            {`Prices are the total for the term. Up to ${PACKAGE_MAX_ONLINE_SLOTS} slots and ${onlineMaxCents === null ? "the most Ozow accepts in one payment" : formatPlanPrice(onlineMaxCents)} are paid online. For 1 to 4 posts, Individual slots cost ${formatPlanPrice(RETAIL_OFFERS[0].priceCents)} each per 30 days.`}
          </p>
          <MultiListingPlans onlineMaxCents={onlineMaxCents} />
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
