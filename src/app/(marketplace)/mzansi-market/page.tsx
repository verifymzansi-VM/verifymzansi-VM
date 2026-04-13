import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ShowroomCardCarousel } from "@/components/showrooms/showroom-card-carousel";
import { listingToCarouselItem } from "@/components/showrooms/carousel-item-transforms";
import { PageHeader } from "@/components/layout";
import { TrustStrip } from "@/components/layout/trust-strip";
import { ListingFilterSidebar } from "@/components/listings/listing-filter-sidebar";
import { ListingFilterDrawer } from "@/components/listings/listing-filter-drawer";
import { ListingGridHeader } from "@/components/listings/listing-grid-header";
import { MzansiMarketGrid } from "./grid";
import { MarketplaceUrlFilterSync } from "./url-filter-sync";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export const metadata: Metadata = {
  title: "Mzansi Market",
  description:
    "Browse verified classified ads for property, cars, electronics and more across South Africa.",
  alternates: {
    canonical: `${BASE_URL}/mzansi-market`,
  },
};

/** Revalidate marketplace data every 60 seconds (ISR) */
export const revalidate = 60;

export default async function MzansiMarketPage() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();

  const { data: listings } = await supabase
    .from("listings")
    .select("*")
    .eq("status", "live")
    .eq("area", "MZANSI_MARKET")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const carouselItems = (listings ?? [])
    .filter((listing) => !shouldHidePlaywrightFixtureRowWhenEnabled(listing, hideFixtures))
    .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
    .slice(0, 5)
    .map((l) => listingToCarouselItem(l));

  return (
    <div className="space-y-0">
      <Suspense fallback={null}>
        <MarketplaceUrlFilterSync />
      </Suspense>

      {/* ── Card Carousel Showroom ─────────────── */}
      <ShowroomCardCarousel
        items={carouselItems}
        emptyTitle="Mzansi Market"
        emptyDescription="Browse classified ads from identity-verified members."
      />

      <TrustStrip variant="green" />

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-8 space-y-6">
        {/* Compact mobile header */}
        <div className="flex items-center justify-between lg:hidden">
          <h1 className="font-display text-lg font-bold tracking-tight">Browse Listings</h1>
          <Button asChild size="sm" className="h-11 gap-1">
            <Link href="/post/create-listing">
              New Post
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* Mobile filter drawer (FAB visible < lg only) */}
        <ListingFilterDrawer />

        {/* Two-column layout */}
        <div className="flex gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1 scrollbar-thin">
              <ListingFilterSidebar />
            </div>
          </aside>

          {/* Main content area */}
          <div className="flex-1 min-w-0 space-y-5">
            <PageHeader
              title="Browse Listings"
              description="Verified classifieds from South African sellers, with filters for price, condition, and location."
              breadcrumbs={[{ label: "Mzansi Market" }]}
              className="hidden lg:block"
            >
              <Button asChild size="sm" className="h-11 gap-1">
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
  );
}
