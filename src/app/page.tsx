import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MobileNav } from "@/components/layout/mobile-nav";
import { HomeOnboardingDestinations } from "@/components/home/home-onboarding-destinations";
import { MarketplacePreviewsSkeleton } from "@/components/home/marketplace-previews-skeleton";
import { HeroBannerWithData } from "@/components/home/hero-banner-with-data";
import { HeroBannerSkeleton } from "@/components/home/hero-banner-skeleton";
import { HomeMzansiMarketShowcase } from "@/components/home/home-mzansi-market-showcase";
import { HomeBusinessShowcase } from "@/components/home/home-business-showcase";
import { HomePromotionsShowcase } from "@/components/home/home-promotions-showcase";
import { HELLO_CONTACT_EMAIL } from "@/lib/contact-email";
import { getServerPublicRuntimeConfig } from "@/lib/public-runtime-config";
import { getOfficialSocialSameAs } from "@/lib/official-social-links";
import { FREE_POST_CONFIG } from "@/lib/constants/pricing";
import {
  VERIFY_MZANSI_CATEGORY_SEO,
  VERIFY_MZANSI_SITE_DESCRIPTION,
} from "@/lib/seo/public-categories";

export const metadata: Metadata = {
  title: "VerifyMzansi - Mzansi Market, Mzansi Business, Tourism and Events",
  description: VERIFY_MZANSI_SITE_DESCRIPTION,
  openGraph: {
    title: "VerifyMzansi - Mzansi Market, Mzansi Business, Tourism and Events",
    description: VERIFY_MZANSI_SITE_DESCRIPTION,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "VerifyMzansi" }],
  },
};

/** Revalidate homepage data every 60 seconds (ISR) */
export const revalidate = 60;

export default async function HomePage() {
  const runtimeConfig = getServerPublicRuntimeConfig();
  const url = runtimeConfig.appUrl || "https://verifymzansi.com";
  const sameAs = getOfficialSocialSameAs(runtimeConfig.officialSocialLinks);
  const categoryStyles = {
    "tourism-events": {
      iconKey: "tourism",
      accentClass: "text-teal-400",
      iconBgClass: "bg-teal-500/10",
    },
    "mzansi-business": {
      iconKey: "business",
      accentClass: "text-brand-blue",
      iconBgClass: "bg-brand-blue/10",
    },
    "mzansi-market": {
      iconKey: "market",
      accentClass: "text-brand-green",
      iconBgClass: "bg-brand-green/10",
    },
  } as const;
  const onboardingDestinations = VERIFY_MZANSI_CATEGORY_SEO.map((category) => ({
    id: category.id,
    title: category.name,
    description: category.description,
    href: category.href,
    ...categoryStyles[category.id],
  }));
  const freePostCount = Number(FREE_POST_CONFIG.maxAllowed);
  const freePostHighlights = [
    `${freePostCount} free ${freePostCount === 1 ? "post" : "posts"} per area`,
    `${FREE_POST_CONFIG.maxPhotos} photos + ${FREE_POST_CONFIG.maxVideos} video`,
    "Trust-first publishing",
  ] as const;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: "VerifyMzansi",
        url,
        description: VERIFY_MZANSI_SITE_DESCRIPTION,
        about: VERIFY_MZANSI_CATEGORY_SEO.map((category) => category.searchName),
        hasPart: VERIFY_MZANSI_CATEGORY_SEO.map((category) => ({
          "@type": "CollectionPage",
          name: category.searchName,
          alternateName: category.name,
          url: `${url}${category.href}`,
          description: category.searchSummary,
        })),
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
        logo: `${url}/icons/icon-1024.png?v=10`,
        sameAs,
        contactPoint: {
          "@type": "ContactPoint",
          email: HELLO_CONTACT_EMAIL,
          contactType: "customer support",
        },
      },
      {
        "@type": "SiteNavigationElement",
        name: "VerifyMzansi category navigation",
        hasPart: VERIFY_MZANSI_CATEGORY_SEO.map((category, index) => ({
          "@type": "SiteNavigationElement",
          position: index + 1,
          name: category.searchName,
          alternateName: category.name,
          url: `${url}${category.href}`,
          description: category.searchSummary,
        })),
      },
      {
        "@type": "ItemList",
        name: "VerifyMzansi categories",
        itemListElement: VERIFY_MZANSI_CATEGORY_SEO.map((category, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "WebPage",
            name: category.searchName,
            alternateName: category.name,
            url: `${url}${category.href}`,
            description: category.searchSummary,
          },
        })),
      },
    ],
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />

      <main id="main-content" className="flex-1 pb-24 md:pb-0 scroll-mt-24">
        {/* ═══ Hero Banner (rotating promotions + search) ═══ */}
        <Suspense fallback={<HeroBannerSkeleton />}>
          <HeroBannerWithData />
        </Suspense>

        <div className="relative overflow-hidden bg-[radial-gradient(circle_at_top,rgba(247,250,252,0.95),rgba(255,255,255,1)_35%,rgba(244,246,248,1)_100%)] dark:bg-[radial-gradient(circle_at_top,rgba(10,14,20,0.98),rgba(6,9,13,1)_38%,rgba(3,5,8,1)_100%)]">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/[0.04] to-transparent dark:from-white/[0.02]"
            aria-hidden="true"
          />

          <div className="lg:-mt-10">
            {/* ═══ Marketplace Showcase ═══ */}
            <Suspense fallback={<MarketplacePreviewsSkeleton />}>
              <HomePromotionsShowcase />
            </Suspense>

            <Suspense fallback={<MarketplacePreviewsSkeleton />}>
              <HomeBusinessShowcase />
            </Suspense>

            <Suspense fallback={<MarketplacePreviewsSkeleton />}>
              <HomeMzansiMarketShowcase />
            </Suspense>
          </div>

          {/* ═══ Onboarding Guide Section ═══ */}
          <section className="relative py-4 sm:py-5 lg:py-6">
            <div className="container-page">
              <div className="relative overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] shadow-[0_28px_90px_-56px_rgba(15,23,42,0.5)] backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(145deg,rgba(8,11,16,0.96),rgba(6,9,14,0.98))]">
                <div
                  className="pointer-events-none absolute -right-12 top-0 h-48 w-48 rounded-full bg-brand-green/15 blur-3xl"
                  aria-hidden="true"
                />
                <div className="relative grid gap-6 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-8 lg:px-8 lg:py-7">
                  <div className="space-y-5">
                    <div className="inline-flex items-center gap-2 rounded-full border border-brand-green/15 bg-brand-green/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-green-800 shadow-sm dark:border-brand-green/20 dark:bg-brand-green/15 dark:text-brand-green-100">
                      <span className="h-2 w-2 rounded-full bg-brand-green-500" />
                      Get Started
                    </div>

                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {freePostHighlights.map((highlight) => (
                          <span
                            key={highlight}
                            className="inline-flex rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-[11px] font-medium text-slate-600 shadow-sm dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200"
                          >
                            {highlight}
                          </span>
                        ))}
                      </div>
                      <h1 className="font-display text-2xl font-bold leading-[1.05] tracking-tight text-slate-950 dark:text-white sm:text-4xl">
                        Find and post trusted listings across South Africa.
                      </h1>

                      <p className="max-w-2xl text-base text-slate-600 dark:text-slate-300 sm:text-lg">
                        Browse or advertise marketplace items, business services, tourism stays and
                        experiences, venues, and events. Start with free posts, add photos or
                        videos, complete verification, and upgrade when you want more visibility.
                      </p>
                    </div>

                    <div className="rounded-[1.5rem] border border-slate-200/80 bg-white/80 p-4 shadow-inner dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        How it works
                      </p>
                      <ol className="mt-4 space-y-3">
                        {[
                          {
                            title: "Create your profile",
                            detail: "Set up an account for your business, brand, or selling goals.",
                          },
                          {
                            title: "Complete verification",
                            detail:
                              "Complete person-level checks with phone, ID evidence, selfie, and location.",
                          },
                          {
                            title: "Choose your category",
                            detail:
                              "Post marketplace listings, business profiles, tourism offers, venues, or events.",
                          },
                        ].map((step, index) => (
                          <li
                            key={step.title}
                            className="flex items-start gap-3 text-slate-700 dark:text-slate-200"
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green/12 text-sm font-semibold text-brand-green-700 dark:bg-brand-green/15 dark:text-brand-green-200">
                              {index + 1}
                            </span>
                            <div className="pt-1">
                              <span className="text-sm font-semibold sm:text-base">
                                {step.title}
                              </span>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
                                {step.detail}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                      <Button
                        asChild
                        size="lg"
                        className="h-12 w-full gap-2 rounded-full bg-brand-green px-8 text-base font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:bg-brand-green-600 sm:w-auto"
                      >
                        <Link href="/post/create" prefetch={false}>
                          Post for Free
                          <ArrowRight className="h-5 w-5" />
                        </Link>
                      </Button>
                      <Button
                        asChild
                        size="lg"
                        variant="outline"
                        className="h-12 w-full rounded-full border-slate-300/80 bg-white/90 px-8 text-base text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:bg-white dark:border-white/15 dark:bg-white/[0.04] dark:text-white dark:hover:bg-white/[0.08] sm:w-auto"
                      >
                        <Link href="/register" prefetch={false}>
                          Create Account
                        </Link>
                      </Button>
                    </div>

                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                      <Link
                        href="/advertise"
                        prefetch={false}
                        className="inline-flex items-center gap-2 rounded-full text-sm font-medium text-brand-green transition-colors hover:text-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:hover:text-brand-green-300 dark:focus-visible:ring-white/25 dark:focus-visible:ring-offset-slate-950"
                      >
                        Advertise
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <Link
                        href="/pricing"
                        prefetch={false}
                        className="inline-flex items-center gap-2 rounded-full text-sm font-medium text-slate-700 transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:text-slate-200 dark:hover:text-white dark:focus-visible:ring-white/25 dark:focus-visible:ring-offset-slate-950"
                      >
                        Pricing
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>

                  <HomeOnboardingDestinations destinations={onboardingDestinations} />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>

      <Footer />
      <MobileNav />
    </div>
  );
}
