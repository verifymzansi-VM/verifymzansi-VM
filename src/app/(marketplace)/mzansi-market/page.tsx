import type { Metadata } from "next";
import { HomeProgrammeShowcase } from "@/components/home/home-programme-showcase";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { ShowroomCardCarousel } from "@/components/showrooms/showroom-card-carousel";
import { mzansiMarketShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import { listingToCarouselItem } from "@/components/showrooms/carousel-item-transforms";
import { AreaHero } from "@/components/layout/area-hero";
import { DisableMobileAutoplay } from "@/contexts/autoplay-policy-context";
import { ListingFilterSidebar } from "@/components/listings/listing-filter-sidebar";
import { ListingFilterDrawer } from "@/components/listings/listing-filter-drawer";
import { ListingGridHeader } from "@/components/listings/listing-grid-header";
import { MzansiMarketGrid } from "./grid";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";
import { getRequiredVerifyMzansiCategorySeo } from "@/lib/seo/public-categories";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
const categorySeo = getRequiredVerifyMzansiCategorySeo("mzansi-market");

const MARKET_QUICK_LINKS = [
  { label: "Vehicles", href: "/mzansi-market?category=vehicles" },
  { label: "Phones & electronics", href: "/mzansi-market?category=electronics" },
  { label: "Property", href: "/mzansi-market?category=property" },
  { label: "Home & lifestyle", href: "/mzansi-market?category=home_lifestyle" },
  { label: "Auto parts", href: "/mzansi-market?category=auto_parts" },
  { label: "Baby & kids", href: "/mzansi-market?category=baby_kids" },
  { label: "Farming", href: "/mzansi-market?category=farming_agriculture" },
] as const;

export const metadata: Metadata = {
  title: categorySeo.title,
  description: categorySeo.description,
  alternates: {
    canonical: `${BASE_URL}/mzansi-market`,
  },
  openGraph: {
    title: categorySeo.title,
    description: categorySeo.description,
    url: `${BASE_URL}/mzansi-market`,
  },
};

/** Revalidate marketplace data every 60 seconds (ISR) */
export const revalidate = 60;

export default async function MzansiMarketPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: categorySeo.searchName,
    alternateName: categorySeo.name,
    url: `${BASE_URL}/mzansi-market`,
    description: categorySeo.searchSummary,
    isPartOf: {
      "@type": "WebSite",
      name: "VerifyMzansi",
      url: BASE_URL,
    },
    about: ["classified ads", "local marketplace", "identity-reviewed members", "South Africa"],
  };
  const cookieStore = await getOptionalCookieStore();
  const hideFixtures = shouldHidePlaywrightFixtures(
    readCookieValue(cookieStore, PLAYWRIGHT_HIDE_FIXTURES_COOKIE)
  );
  const supabase = await createClient();

  const { data: listings } = await applyVisibleExpiryFilter(
    supabase.from("listings").select("*").eq("status", "live").eq("area", "MZANSI_MARKET")
  )
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const carouselItems = (listings ?? [])
    .filter((listing) => !shouldHidePlaywrightFixtureRowWhenEnabled(listing, hideFixtures))
    .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
    .slice(0, 7)
    .map((l) => listingToCarouselItem(l));

  return (
    <DisableMobileAutoplay>
      <div className="space-y-0">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
        />
        <Suspense fallback={null}>
          <MarketplaceUrlFilterSync />
        </Suspense>

        <AreaHero
          area="market"
          title={categorySeo.searchName}
          description="Buy and sell locally."
          trustLine="ID-reviewed sellers"
          ctaHref="/post/create-listing"
          ctaLabel="Create a listing"
          quickLinks={MARKET_QUICK_LINKS}
        />

        {/* ── Card Carousel Showroom ─────────────── */}
        <ShowroomCardCarousel
          items={carouselItems}
          emptyTitle="Mzansi Market"
          emptyDescription={categorySeo.description}
          emptyMediaUrl="/images/fallbacks/hero-listing.svg"
          background={mzansiMarketShowroomBackground}
        />

        <Suspense fallback={null}>
          <HomeProgrammeShowcase placement="market" />
        </Suspense>

        {/* ── Main Content ─────────────────────────────────── */}
        <div className="container-page space-y-6 py-8 lg:py-10">
          {/* Mobile filter drawer (FAB visible < lg only) */}
          <ListingFilterDrawer />

          {/* Two-column layout */}
          <div className="flex gap-6 lg:gap-8">
            {/* Desktop sidebar */}
            <aside className="hidden w-72 shrink-0 lg:block" aria-label="Listing filters">
              <div className="sticky top-32 max-h-[calc(100vh-9rem)] overflow-y-auto pr-1 scrollbar-thin">
                <ListingFilterSidebar />
              </div>
            </aside>

            {/* Main content area */}
            <div className="min-w-0 flex-1 space-y-5">
              <div>
                <h2 className="section-title">Latest listings</h2>
                <p className="section-lede">Newest first. Boosted posts appear at the top.</p>
              </div>

              {/* Toolbar: location + sort + active chips */}
              <ListingGridHeader />

              {/* Listings grid */}
              <MzansiMarketGrid />
            </div>
          </div>
        </div>
      </div>
    </DisableMobileAutoplay>
  );
}
