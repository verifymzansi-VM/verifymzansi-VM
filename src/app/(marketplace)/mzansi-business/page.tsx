import type { Metadata } from "next";
import { HomeProgrammeShowcase } from "@/components/home/home-programme-showcase";
import { createClient } from "@/lib/supabase/server";
import { ShowroomCardCarousel } from "@/components/showrooms/showroom-card-carousel";
import { mzansiBusinessShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import {
  businessToCarouselItem,
  type CarouselItem,
} from "@/components/showrooms/carousel-item-transforms";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { AreaHero } from "@/components/layout/area-hero";
import { DisableMobileAutoplay } from "@/contexts/autoplay-policy-context";
import { MzansiBusinessGrid } from "./grid";
import { MzansiBusinessFilterSync } from "./filter-sync";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";

import { BusinessDiscoveryBar } from "./discovery-bar";
import { BusinessFilterDrawer } from "@/components/listings/business-filter-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";

import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getRequiredVerifyMzansiCategorySeo } from "@/lib/seo/public-categories";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
const categorySeo = getRequiredVerifyMzansiCategorySeo("mzansi-business");

const BUSINESS_QUICK_LINKS = [
  { label: "Trades & repairs", href: "/mzansi-business?category=trade_maintenance" },
  { label: "Food & dining", href: "/mzansi-business?category=food_dining" },
  { label: "Health & beauty", href: "/mzansi-business?category=health_beauty" },
  { label: "Professional services", href: "/mzansi-business?category=professional_services" },
  { label: "Automotive", href: "/mzansi-business?category=automotive_transport" },
  { label: "Education", href: "/mzansi-business?category=education_training" },
  { label: "Fashion", href: "/mzansi-business?category=fashion_accessories" },
] as const;

export const metadata: Metadata = {
  title: categorySeo.title,
  description: categorySeo.description,
  alternates: {
    canonical: `${BASE_URL}/mzansi-business`,
  },
  openGraph: {
    title: categorySeo.title,
    description: categorySeo.description,
    url: `${BASE_URL}/mzansi-business`,
  },
};

/** Revalidate every 60 seconds (ISR) */
export const revalidate = 60;

export default async function MzansiBusinessPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: categorySeo.searchName,
    alternateName: categorySeo.name,
    url: `${BASE_URL}/mzansi-business`,
    description: categorySeo.searchSummary,
    isPartOf: {
      "@type": "WebSite",
      name: "VerifyMzansi",
      url: BASE_URL,
    },
    about: ["business directory", "local services", "verified representatives", "South Africa"],
  };
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();

  // Fetch top businesses for showroom hero
  const { data: topBusinesses } = await applyVisibleExpiryFilter(
    supabase.from("businesses").select("*").eq("status", "live").eq("area", "MZANSI_BUSINESS")
  )
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const visibleTopBusinesses = (topBusinesses ?? [])
    .filter((business) => !shouldHidePlaywrightFixtureRowWhenEnabled(business, hideFixtures))
    .filter(
      (business) => !isPlaceholderMarketplaceContent(business.business_name, business.description)
    )
    .slice(0, 7);

  const carouselItems: CarouselItem[] =
    visibleTopBusinesses.length > 0
      ? visibleTopBusinesses.map((b) => businessToCarouselItem(b))
      : [
          {
            id: "mzansi-business-empty",
            type: "business",
            href: "/post/create-business",
            title: "Mzansi Business",
            description: categorySeo.description,
            location: "South Africa",
            mediaUrl: "/images/fallbacks/hero-business.svg",
          },
        ];

  return (
    <DisableMobileAutoplay>
      <div className="space-y-0">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
        />
        <Suspense fallback={<div className="h-10" />}>
          <MzansiBusinessFilterSync />
        </Suspense>

        <AreaHero
          area="business"
          title="Mzansi Business"
          description="Shops, trades and services near you."
          trustLine="ID-reviewed representatives"
          ctaHref="/post/create-business"
          ctaLabel="Add your business"
          quickLinks={BUSINESS_QUICK_LINKS}
        />

        {/* ── Card Carousel Showroom ─────────────── */}
        <ShowroomCardCarousel
          items={carouselItems}
          emptyTitle="Mzansi Business"
          emptyDescription={categorySeo.description}
          background={mzansiBusinessShowroomBackground}
        />

        <Suspense fallback={null}>
          <HomeProgrammeShowcase placement="business" />
        </Suspense>

        {/* ── Main Content ─────────────────────────────────── */}
        <div className="container-page space-y-6 py-8 lg:py-10">
          {/* Mobile filter drawer (FAB visible < lg only) */}
          <BusinessFilterDrawer />

          <div className="flex gap-6 lg:gap-8">
            <aside className="hidden w-72 shrink-0 lg:block" aria-label="Business filters">
              <div className="sticky top-32 rounded-3xl border border-border/70 bg-card p-5 elev-xs">
                <Suspense
                  fallback={
                    <div className="space-y-3">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-6 w-3/4" />
                      <Skeleton className="h-6 w-1/2" />
                      <Skeleton className="h-6 w-2/3" />
                    </div>
                  }
                >
                  <BusinessDiscoveryBar />
                </Suspense>
              </div>
            </aside>

            <section className="min-w-0 flex-1 space-y-6" aria-labelledby="business-grid-title">
              <div>
                <h2 id="business-grid-title" className="section-title">
                  Latest businesses
                </h2>
                <p className="section-lede">
                  Open a profile to see services, hours, who represents it and how to get in touch.
                </p>
              </div>

              <Suspense fallback={<ListingGridSkeleton count={6} />}>
                <MzansiBusinessGrid />
              </Suspense>
            </section>
          </div>
        </div>
      </div>
    </DisableMobileAutoplay>
  );
}
