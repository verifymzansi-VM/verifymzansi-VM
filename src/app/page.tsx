import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Car,
  Home,
  Wrench,
  Smartphone,
  Sofa,
  Briefcase,
  Building2,
  Megaphone,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MarketplacePreviewsSkeleton } from "@/components/home/marketplace-previews-skeleton";
import { HeroBannerWithData } from "@/components/home/hero-banner-with-data";
import { HeroBannerSkeleton } from "@/components/home/hero-banner-skeleton";
import { HomeMzansiMarketShowcase } from "@/components/home/home-mzansi-market-showcase";
import { HomeBusinessShowcase } from "@/components/home/home-business-showcase";
import { HomePromotionsShowcase } from "@/components/home/home-promotions-showcase";

export const metadata: Metadata = {
  title: "VerifyMzansi — SA's Trusted Marketplace",
  description:
    "Buy & sell with verified sellers. South Africa's verification-first marketplace for classifieds, businesses, and promotions.",
  openGraph: {
    title: "VerifyMzansi — SA's Trusted Marketplace",
    description:
      "Buy & sell with verified sellers. South Africa's verification-first marketplace for classifieds, businesses, and promotions.",
  },
};

/** Revalidate homepage data every 60 seconds (ISR) */
export const revalidate = 60;

export default async function HomePage() {
  const url = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
  const onboardingDestinations = [
    {
      title: "Mzansi Market",
      description: "Browse or post verified listings for everyday buying and selling.",
      href: "/mzansi-market",
      icon: ShoppingBag,
      accentClass: "text-brand-green",
      iconBgClass: "bg-brand-green/10",
    },
    {
      title: "Mzansi Business",
      description: "Find trusted businesses or create a profile for your services.",
      href: "/mzansi-business",
      icon: Building2,
      accentClass: "text-brand-blue",
      iconBgClass: "bg-brand-blue/10",
    },
    {
      title: "Promotions & Events",
      description: "Discover current offers and events or advertise a new campaign.",
      href: "/promotions",
      icon: Megaphone,
      accentClass: "text-red-400",
      iconBgClass: "bg-red-500/10",
    },
  ] as const;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "VerifyMzansi",
        url: url || "https://verifymzansi.com",
        description:
          "South Africa's verification-first marketplace for classifieds, shops, and business services.",
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${url || "https://verifymzansi.com"}/mzansi-market?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: "VerifyMzansi",
        url: url || "https://verifymzansi.com",
        logo: `${url || "https://verifymzansi.com"}/icons/icon-512.png`,
        sameAs: [],
        contactPoint: {
          "@type": "ContactPoint",
          email: "hello@verifymzansi.co.za",
          contactType: "customer support",
        },
      },
    ],
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="flex-1">
        {/* ═══ Hero Banner (rotating promotions + search) ═══ */}
        <Suspense fallback={<HeroBannerSkeleton />}>
          <HeroBannerWithData />
        </Suspense>

        {/* ═══ Browse by Category ═══ */}
        <section className="py-5 sm:py-8 border-b border-warm-200 dark:border-warm-800 bg-white dark:bg-warm-950">
          <div className="container-page">
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-8 gap-3">
              {[
                {
                  label: "Vehicles",
                  icon: Car,
                  href: "/mzansi-market?category=vehicles",
                  iconBg: "bg-blue-100 dark:bg-blue-950",
                  iconColor: "text-blue-500",
                },
                {
                  label: "Property",
                  icon: Home,
                  href: "/mzansi-market?category=property",
                  iconBg: "bg-teal-100 dark:bg-teal-950",
                  iconColor: "text-teal-500",
                },
                {
                  label: "Jobs",
                  icon: Briefcase,
                  href: "/mzansi-market?category=jobs_services",
                  iconBg: "bg-violet-100 dark:bg-violet-950",
                  iconColor: "text-violet-500",
                },
                {
                  label: "Electronics",
                  icon: Smartphone,
                  href: "/mzansi-market?category=electronics",
                  iconBg: "bg-gray-100 dark:bg-gray-800",
                  iconColor: "text-gray-500 dark:text-gray-400",
                },
                {
                  label: "Auto Parts",
                  icon: Wrench,
                  href: "/mzansi-market?category=auto_parts",
                  iconBg: "bg-rose-100 dark:bg-rose-950",
                  iconColor: "text-rose-400",
                },
                {
                  label: "Home & Living",
                  icon: Sofa,
                  href: "/mzansi-market?category=home_lifestyle",
                  iconBg: "bg-green-100 dark:bg-green-950",
                  iconColor: "text-green-500",
                },
                {
                  label: "Business",
                  icon: Building2,
                  href: "/mzansi-business",
                  iconBg: "bg-blue-100 dark:bg-blue-950",
                  iconColor: "text-blue-500",
                },
                {
                  label: "Promotions",
                  icon: Megaphone,
                  href: "/promotions",
                  iconBg: "bg-red-100 dark:bg-red-950",
                  iconColor: "text-red-500",
                },
              ].map(({ label, icon: Icon, href, iconBg, iconColor }) => (
                <Link
                  key={label}
                  href={href}
                  className="group flex flex-col items-center gap-2 p-3 rounded-xl border border-warm-200 dark:border-warm-700 bg-white dark:bg-warm-900 hover:shadow-md hover:border-warm-300 dark:hover:border-warm-600 transition-all duration-200"
                >
                  <div
                    className={`flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full ${iconBg} ${iconColor} transition-transform duration-200 group-hover:scale-110`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-center text-foreground leading-tight">
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ Marketplace Showcase ═══ */}
        <Suspense fallback={<MarketplacePreviewsSkeleton />}>
          <HomeMzansiMarketShowcase />
        </Suspense>

        <Suspense fallback={<MarketplacePreviewsSkeleton />}>
          <HomeBusinessShowcase />
        </Suspense>

        <Suspense fallback={<MarketplacePreviewsSkeleton />}>
          <HomePromotionsShowcase />
        </Suspense>

        {/* ═══ Onboarding Guide Section ═══ */}
        <section className="py-4 sm:py-6 relative overflow-hidden bg-warm-950 dark:bg-black">
          <div className="container-page relative z-10">
            <div className="bg-gradient-to-br from-warm-900/50 to-warm-950/80 backdrop-blur-xl border border-white/10 rounded-2xl p-5 sm:p-6 lg:p-8 shadow-2xl overflow-hidden relative">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-8 relative z-10">
                <div className="space-y-5">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-brand-green-300 text-xs font-medium">
                    <span className="h-2 w-2 rounded-full bg-brand-green-400" />
                    New to VerifyMzansi?
                  </div>

                  <div className="space-y-3">
                    <h2 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-white leading-[1.1]">
                      Start here on{" "}
                      <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-green-400 to-brand-gold-400">
                        VerifyMzansi
                      </span>
                    </h2>

                    <p className="text-warm-100 text-base sm:text-lg max-w-2xl">
                      VerifyMzansi is for South Africans who want to buy, sell, find trusted
                      businesses, or advertise promotions with more confidence through verified
                      accounts.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-warm-300">
                      How it works
                    </p>
                    <ol className="mt-4 space-y-3">
                      {[
                        "Create an account",
                        "Complete verification",
                        "Browse or post in the area that fits your goal",
                      ].map((step, index) => (
                        <li key={step} className="flex items-start gap-3 text-warm-100">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-sm font-semibold text-brand-green-300">
                            {index + 1}
                          </span>
                          <span className="pt-1 text-sm sm:text-base">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <Button
                      asChild
                      size="lg"
                      className="w-full sm:w-auto h-12 px-8 text-base bg-brand-green hover:bg-brand-green-600 text-white transition-all gap-2 rounded-full font-semibold"
                    >
                      <Link href="/register">
                        Create your account
                        <ArrowRight className="h-5 w-5" />
                      </Link>
                    </Button>

                    <Link
                      href="/pricing"
                      className="inline-flex items-center gap-2 text-sm font-medium text-warm-100 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-950 rounded-full"
                    >
                      See pricing and plans
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>

                <div className="grid gap-3 self-start">
                  {onboardingDestinations.map(
                    ({ title, description, href, icon: Icon, accentClass, iconBgClass }) => (
                      <Link
                        key={title}
                        href={href}
                        className="group rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5 transition-all duration-200 hover:border-white/20 hover:bg-white/10 hover:-translate-y-0.5"
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${iconBgClass} ${accentClass}`}
                          >
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-base font-semibold text-white">{title}</p>
                              <ArrowRight className="h-4 w-4 shrink-0 text-warm-400 transition-transform group-hover:translate-x-1" />
                            </div>
                            <p className="text-sm leading-6 text-warm-200">{description}</p>
                          </div>
                        </div>
                      </Link>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
