import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Building2, ShoppingBag, TreePalm } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
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

/** The three VerifyMzansi areas, shown as photo tiles in each area's colour. */
const CATEGORY_TILES = {
  "mzansi-market": {
    icon: ShoppingBag,
    image: "/images/showrooms/market-v2-mobile.avif",
    tint: "from-brand-green-900/85 via-brand-green-800/35",
    chip: "bg-brand-green-600",
  },
  "mzansi-business": {
    icon: Building2,
    image: "/images/showrooms/business-v2-mobile.avif",
    tint: "from-brand-blue-900/85 via-brand-blue-800/35",
    chip: "bg-brand-blue-600",
  },
  "tourism-events": {
    icon: TreePalm,
    image: "/images/showrooms/tourism-v2-mobile.avif",
    tint: "from-teal-900/85 via-teal-800/35",
    chip: "bg-teal-600",
  },
} as const;

export default async function HomePage() {
  const runtimeConfig = getServerPublicRuntimeConfig();
  const url = runtimeConfig.appUrl || "https://verifymzansi.com";
  const sameAs = getOfficialSocialSameAs(runtimeConfig.officialSocialLinks);

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
        <Header />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
        />

        <main id="main-content" className="flex-1 scroll-mt-24">
          <h1 className="sr-only">
            VerifyMzansi: Mzansi Market, Mzansi Business, Tourism and Events
          </h1>

          {/* ═══ Showroom: our clients' posts, first thing on the page ═══ */}
          <section aria-labelledby="home-showroom-title">
            <h2 id="home-showroom-title" className="sr-only">
              Showroom
            </h2>
            <Suspense fallback={<HeroBannerSkeleton />}>
              <HeroBannerWithData />
            </Suspense>
          </section>

          {/* ═══ The three areas ═══ */}
          <nav aria-label="VerifyMzansi primary categories" className="container-page py-5 sm:py-8">
            <ul className="grid grid-cols-3 gap-2.5 sm:gap-4">
              {VERIFY_MZANSI_CATEGORY_SEO.map((category) => {
                const tile = CATEGORY_TILES[category.id];
                const Icon = tile.icon;
                return (
                  <li key={category.id}>
                    <Link
                      href={category.href}
                      prefetch={false}
                      className="group relative flex aspect-[3/4] items-end overflow-hidden rounded-2xl bg-muted elev-sm transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:aspect-[16/7] sm:rounded-3xl"
                    >
                      <Image
                        src={tile.image}
                        alt=""
                        fill
                        sizes="33vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none"
                      />
                      <span
                        aria-hidden="true"
                        className={`absolute inset-0 bg-gradient-to-t ${tile.tint} to-transparent`}
                      />
                      <span className="relative flex w-full flex-col items-start gap-2 p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-5">
                        <span
                          aria-hidden="true"
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md sm:h-11 sm:w-11 ${tile.chip}`}
                        >
                          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                        </span>
                        <span className="font-display text-sm font-bold leading-tight text-white drop-shadow sm:text-xl">
                          {category.name}
                        </span>
                        <ArrowRight
                          aria-hidden="true"
                          className="ml-auto hidden h-5 w-5 text-white/80 transition-transform group-hover:translate-x-0.5 sm:block"
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* ═══ Latest posts from each area ═══ */}
          <Suspense fallback={<MarketplacePreviewsSkeleton />}>
            <HomePromotionsShowcase />
          </Suspense>

          <Suspense fallback={<MarketplacePreviewsSkeleton />}>
            <HomeBusinessShowcase />
          </Suspense>

          <Suspense fallback={<MarketplacePreviewsSkeleton />}>
            <HomeMzansiMarketShowcase />
          </Suspense>

          <Suspense fallback={null}>
            <HomeProgrammeShowcase />
          </Suspense>

          {/* ═══ Post for free ═══ */}
          <section aria-labelledby="home-start-title" className="container-page py-10 sm:py-14">
            <div className="flex flex-col items-start gap-5 rounded-3xl bg-gradient-to-br from-brand-green-700 to-brand-green-900 p-6 text-white elev-sm sm:flex-row sm:items-center sm:justify-between sm:p-10">
              <h2
                id="home-start-title"
                className="font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl"
              >
                Your first post is free.
              </h2>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  asChild
                  size="lg"
                  className="h-12 rounded-full bg-white px-7 text-base font-semibold text-brand-green-800 hover:bg-white/90"
                >
                  <Link href="/post/create" prefetch={false}>
                    Post for Free
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </Link>
                </Button>
                <div className="flex items-center gap-5 px-1 text-sm font-semibold">
                  <Link href="/pricing" prefetch={false} className="hover:underline">
                    Pricing
                  </Link>
                  <Link href="/advertise" prefetch={false} className="hover:underline">
                    Advertise
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    </DisableMobileAutoplay>
  );
}
