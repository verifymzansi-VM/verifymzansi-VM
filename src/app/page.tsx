import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Building2, Megaphone, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";
import { MarketplacePreviewsSkeleton } from "@/components/home/marketplace-previews-skeleton";
import { HeroBannerWithData } from "@/components/home/hero-banner-with-data";
import { HeroBannerSkeleton } from "@/components/home/hero-banner-skeleton";
import { HomeMzansiMarketShowcase } from "@/components/home/home-mzansi-market-showcase";
import { HomeBusinessShowcase } from "@/components/home/home-business-showcase";
import { HomePromotionsShowcase } from "@/components/home/home-promotions-showcase";

export const metadata: Metadata = {
  title: "VerifyMzansi — SA's Trusted Marketplace",
  description:
    "Buy, sell, advertise, and discover trusted businesses with verified accounts. South Africa's verification-first marketplace for classifieds, businesses, and promotions.",
  openGraph: {
    title: "VerifyMzansi — SA's Trusted Marketplace",
    description:
      "Buy, sell, advertise, and discover trusted businesses with verified accounts. South Africa's verification-first marketplace for classifieds, businesses, and promotions.",
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
        url,
        description:
          "South Africa's verification-first marketplace for classifieds, shops, and business services.",
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${url}/mzansi-market?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: "VerifyMzansi",
        url,
        logo: `${url}/icons/icon-512.png`,
        sameAs: [],
        contactPoint: {
          "@type": "ContactPoint",
          email: "hello@verifymzansi.com",
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

      <main className="flex-1 pb-20 md:pb-0">
        {/* ═══ Hero Banner (rotating promotions + search) ═══ */}
        <Suspense fallback={<HeroBannerSkeleton />}>
          <HeroBannerWithData />
        </Suspense>

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
                        {
                          title: "Create an account",
                          detail: "Sign up with your phone number or email.",
                        },
                        {
                          title: "Complete verification",
                          detail:
                            "Verify your identity with a phone OTP, ID document, selfie, and location — it only takes a few minutes.",
                        },
                        {
                          title: "Browse or post in the area that fits your goal",
                          detail:
                            "List items for sale, register your business, or discover verified sellers and services.",
                        },
                      ].map((step, index) => (
                        <li key={step.title} className="flex items-start gap-3 text-warm-100">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-green/15 text-sm font-semibold text-brand-green-300">
                            {index + 1}
                          </span>
                          <div className="pt-1">
                            <span className="text-sm sm:text-base font-medium">{step.title}</span>
                            <p className="text-xs sm:text-sm text-warm-300 mt-0.5">{step.detail}</p>
                          </div>
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
      <MobileNav />
    </div>
  );
}
