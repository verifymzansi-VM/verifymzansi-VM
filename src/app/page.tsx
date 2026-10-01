import { Suspense } from "react";
import type { Metadata } from "next";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { MarketplacePreviewsSkeleton } from "@/components/home/marketplace-previews-skeleton";
import { HeroBannerWithData } from "@/components/home/hero-banner-with-data";
import { HeroBannerSkeleton } from "@/components/home/hero-banner-skeleton";
import { HomeMzansiMarketShowcase } from "@/components/home/home-mzansi-market-showcase";
import { HomeBusinessShowcase } from "@/components/home/home-business-showcase";
import { HomeProgrammeShowcase } from "@/components/home/home-programme-showcase";
import { HomePromotionsShowcase } from "@/components/home/home-promotions-showcase";
import { HomeAboutSection } from "@/components/home/home-about-section";
import { HomeSponsorsSection } from "@/components/home/home-sponsors-section";
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

          <Suspense fallback={null}>
            <HomeSponsorsSection />
          </Suspense>

          {/* ═══ What VerifyMzansi is, why it helps, and how to start ═══ */}
          <HomeAboutSection />
        </main>

        <Footer />
      </div>
    </DisableMobileAutoplay>
  );
}
