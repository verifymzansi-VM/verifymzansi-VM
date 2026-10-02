import type { Metadata } from "next";
import { HomeProgrammeShowcase } from "@/components/home/home-programme-showcase";
import { Suspense } from "react";
import { ShowroomCardCarousel } from "@/components/showrooms/showroom-card-carousel";
import { mzansiMarketShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import { loadShowroomItems, type ShowroomClient } from "@/lib/showroom/feed";
import { createClient } from "@/lib/supabase/server";
import { getVisitorProvince } from "@/lib/showroom/visitor-province";
import { PageHeader } from "@/components/layout";
import { DisableMobileAutoplay } from "@/contexts/autoplay-policy-context";
import { ListingFilterSidebar } from "@/components/listings/listing-filter-sidebar";
import { ListingFilterDrawer } from "@/components/listings/listing-filter-drawer";
import { ListingGridHeader } from "@/components/listings/listing-grid-header";
import { MzansiMarketGrid } from "./grid";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";
import { getRequiredVerifyMzansiCategorySeo } from "@/lib/seo/public-categories";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
const categorySeo = getRequiredVerifyMzansiCategorySeo("mzansi-market");

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
  const visitor = await getVisitorProvince();
  const supabase = await createClient();
  const carouselItems = await loadShowroomItems("market", {
    province: visitor.province,
    hideFixtures,
    client: supabase as unknown as ShowroomClient,
  });

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

        {/* ── Card Carousel Showroom ─────────────── */}
        <ShowroomCardCarousel
          items={carouselItems}
          surface="showroom:market"
          visitorProvince={visitor}
          emptyTitle="Mzansi Market"
          emptyDescription={categorySeo.description}
          emptyMediaUrl="/images/fallbacks/hero-listing.svg"
          background={mzansiMarketShowroomBackground}
        />

        <Suspense fallback={null}>
          <HomeProgrammeShowcase placement="market" />
        </Suspense>

        {/* ── Main Content ─────────────────────────────────── */}
        <div className="container-page py-8 space-y-7 lg:py-10">
          {/* Compact mobile header */}
          <div className="flex items-center justify-between lg:hidden">
            <h1 className="font-display text-lg font-bold tracking-tight">
              {categorySeo.searchName}
            </h1>
            <Button
              asChild
              size="sm"
              variant="trust-verified"
              className="h-11 gap-1 rounded-full px-4 font-semibold"
            >
              <Link href="/post/create-listing">
                Create a listing
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Mobile filter drawer (FAB visible < lg only) */}
          <ListingFilterDrawer />

          {/* Two-column layout */}
          <div className="flex gap-6 lg:gap-8">
            {/* Desktop sidebar */}
            <aside className="hidden w-72 shrink-0 lg:block" aria-label="Listing filters">
              <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1 scrollbar-thin">
                <ListingFilterSidebar />
              </div>
            </aside>

            {/* Main content area */}
            <div className="flex-1 min-w-0 space-y-5">
              <PageHeader
                title={categorySeo.searchName}
                breadcrumbs={[{ label: "Mzansi Market" }]}
                className="hidden lg:block"
              >
                <Button
                  asChild
                  size="sm"
                  variant="trust-verified"
                  className="h-11 gap-1 rounded-full px-4 font-semibold"
                >
                  <Link href="/post/create-listing">
                    Create a listing
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </PageHeader>

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
