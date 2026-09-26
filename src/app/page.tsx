import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, LayoutGrid, UserRoundCheck, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { HomeHero } from "@/components/home/home-hero";
import { HomeCategoryGateways } from "@/components/home/home-category-gateways";
import { HomeTrustSection } from "@/components/home/home-trust-section";
import { MarketplacePreviewsSkeleton } from "@/components/home/marketplace-previews-skeleton";
import { HeroBannerWithData } from "@/components/home/hero-banner-with-data";
import { HeroBannerSkeleton } from "@/components/home/hero-banner-skeleton";
import { HomeMzansiMarketShowcase } from "@/components/home/home-mzansi-market-showcase";
import { HomeBusinessShowcase } from "@/components/home/home-business-showcase";
import { HomeProgrammeShowcase } from "@/components/home/home-programme-showcase";
import { HomePromotionsShowcase } from "@/components/home/home-promotions-showcase";
import { HELLO_CONTACT_EMAIL } from "@/lib/contact-email";
import { DisableMobileAutoplay } from "@/contexts/autoplay-policy-context";
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

const START_STEPS = [
  {
    icon: UserRoundCheck,
    title: "Create your free account",
    detail: "For yourself, your business, or the events you host.",
    tile: "area-market-tile",
  },
  {
    icon: BadgeCheck,
    title: "Complete verification",
    detail: "Phone, ID evidence, selfie and location, reviewed once.",
    tile: "bg-brand-gold/15 text-brand-gold-800 dark:text-brand-gold-300",
  },
  {
    icon: LayoutGrid,
    title: "Choose where to post",
    detail: "Mzansi Market, Mzansi Business, or Tourism & Events.",
    tile: "area-business-tile",
  },
] as const;

export default async function HomePage() {
  const runtimeConfig = getServerPublicRuntimeConfig();
  const url = runtimeConfig.appUrl || "https://verifymzansi.com";
  const sameAs = getOfficialSocialSameAs(runtimeConfig.officialSocialLinks);
  const freePostHighlights = [
    "One free introductory post: 7 or limited 30 days",
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
        logo: `${url}/icons/icon-1024.png?v=20260924`,
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
    <DisableMobileAutoplay>
      <div className="flex min-h-screen flex-col">
        <Header showSearch={false} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
        />

        <main id="main-content" className="flex-1 scroll-mt-24">
          {/* ═══ Hero: what VerifyMzansi is, search, and why to trust it ═══ */}
          <HomeHero />

          {/* ═══ The three product areas ═══ */}
          <HomeCategoryGateways />

          {/* ═══ Spotlight showroom (boosted + newest across all areas) ═══ */}
          <Suspense fallback={<HeroBannerSkeleton />}>
            <HeroBannerWithData
              hideWhenEmpty
              heading={
                <div className="container-page mb-5 flex items-end justify-between gap-4 pt-2">
                  <div>
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-brand-gold-700 dark:text-brand-gold-300">
                      <span aria-hidden="true" className="h-1.5 w-5 rounded-full bg-brand-gold" />
                      Spotlight
                    </p>
                    <h2 className="section-title mt-2">Trending across Mzansi</h2>
                    <p className="section-lede">
                      Boosted and newest posts. Swipe or use the arrows.
                    </p>
                  </div>
                  <Link
                    href="/advertise"
                    prefetch={false}
                    className="link-arrow hidden sm:inline-flex"
                  >
                    Get featured here
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              }
            />
          </Suspense>

          <Suspense fallback={<MarketplacePreviewsSkeleton />}>
            <HomePromotionsShowcase />
          </Suspense>

          <HomeTrustSection />

          <Suspense fallback={<MarketplacePreviewsSkeleton />}>
            <HomeBusinessShowcase />
          </Suspense>

          <Suspense fallback={<MarketplacePreviewsSkeleton />}>
            <HomeMzansiMarketShowcase />
          </Suspense>

          <Suspense fallback={null}>
            <HomeProgrammeShowcase />
          </Suspense>

          {/* ═══ Get started ═══ */}
          <section aria-labelledby="home-start-title" className="container-page py-12 sm:py-16">
            <div className="grid gap-8 rounded-[32px] border border-border/70 bg-card p-6 elev-sm sm:p-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14 lg:p-14">
              <div>
                <span className="section-kicker">Sell, list or host</span>
                <h2
                  id="home-start-title"
                  className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
                >
                  Start in minutes. Your first post is free.
                </h2>
                <p className="mt-3 max-w-lg text-base leading-7 text-muted-foreground">
                  Marketplace items, business profiles, stays, venues and events. Verify once and
                  your badge follows every post.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {freePostHighlights.map((highlight) => (
                    <span key={highlight} className="chip">
                      <Check className="h-3.5 w-3.5 text-brand-green-600" aria-hidden="true" />
                      {highlight}
                    </span>
                  ))}
                </div>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button
                    asChild
                    variant="trust-verified"
                    size="lg"
                    className="h-12 w-full rounded-full px-7 sm:w-auto"
                  >
                    <Link href="/post/create" prefetch={false}>
                      Post for Free
                      <ArrowRight className="h-5 w-5" />
                    </Link>
                  </Button>
                  <div className="flex items-center gap-5 px-1">
                    <Link href="/pricing" prefetch={false} className="link-arrow">
                      Pricing
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href="/advertise" prefetch={false} className="link-arrow">
                      Advertise
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </div>

              <ol className="grid gap-3">
                {START_STEPS.map((step, index) => (
                  <li
                    key={step.title}
                    className="flex items-start gap-4 rounded-2xl border border-border/70 bg-background/60 p-4 sm:p-5"
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${step.tile}`}
                      aria-hidden="true"
                    >
                      <step.icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold tabular-nums text-muted-foreground">
                        Step {index + 1}
                      </p>
                      <h3 className="font-body text-base font-semibold text-foreground">
                        {step.title}
                      </h3>
                      <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
                        {step.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </DisableMobileAutoplay>
  );
}
