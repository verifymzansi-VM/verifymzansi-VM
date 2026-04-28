import { createClient } from "@/lib/supabase/server";
import { ShowroomCardCarousel } from "@/components/showrooms/showroom-card-carousel";
import { mzansiBusinessShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import {
  businessToCarouselItem,
  type CarouselItem,
} from "@/components/showrooms/carousel-item-transforms";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/layout";
import { TrustStrip } from "@/components/layout/trust-strip";
import { MzansiBusinessGrid } from "./grid";
import { MzansiBusinessFilterSync } from "./filter-sync";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";

import { BusinessDiscoveryBar } from "./discovery-bar";
import { BusinessFilterDrawer } from "@/components/listings/business-filter-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";

import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";

export const metadata = {
  title: "Mzansi Business",
  description:
    "Discover business profiles posted by identity-reviewed representatives on VerifyMzansi.",
  alternates: {
    canonical: "/mzansi-business",
  },
};

/** Revalidate every 60 seconds (ISR) */
export const revalidate = 60;

export default async function MzansiBusinessPage() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();

  // Fetch top businesses for showroom hero
  const { data: topBusinesses } = await supabase
    .from("businesses")
    .select("*")
    .eq("status", "live")
    .eq("area", "MZANSI_BUSINESS")
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
            description: "Discover profiles posted by identity-reviewed representatives.",
            location: "South Africa",
            mediaUrl: "/images/fallbacks/hero-shop.svg",
          },
        ];

  return (
    <div className="space-y-0">
      <Suspense fallback={<div className="h-10" />}>
        <MzansiBusinessFilterSync />
      </Suspense>

      {/* ── Card Carousel Showroom ─────────────── */}
      <ShowroomCardCarousel
        items={carouselItems}
        emptyTitle="Mzansi Business"
        emptyDescription="Discover profiles posted by identity-reviewed representatives."
        background={mzansiBusinessShowroomBackground}
      />

      <TrustStrip variant="blue" title="Latest Mzansi Businesses" />

      {/* ── Main Content ─────────────────────────────────── */}
      <div className="container-page py-8 space-y-6">
        {/* Compact mobile header */}
        <div className="flex items-center justify-between lg:hidden">
          <h1 className="font-display text-lg font-bold tracking-tight">Mzansi Business</h1>
          <Button asChild size="sm" className="h-11 gap-1">
            <Link href="/post/create-business">
              New Listing
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        {/* Mobile filter drawer (FAB visible < lg only) */}
        <BusinessFilterDrawer />

        <div className="flex gap-6">
          <aside className="hidden w-72 shrink-0 lg:block">
            <div className="sticky top-24">
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

          <section className="min-w-0 flex-1 space-y-6">
            <PageHeader
              title="Mzansi Business"
              description="Browse South African business profiles posted by identity-reviewed representatives. VerifyMzansi reviews the poster, not the business itself."
              breadcrumbs={[{ label: "Mzansi Business" }]}
              className="hidden lg:block"
            >
              <Button asChild size="sm" className="h-11 gap-2">
                <Link href="/post/create-business">
                  Create Business Profile
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </PageHeader>

            <Suspense fallback={<ListingGridSkeleton count={6} />}>
              <MzansiBusinessGrid />
            </Suspense>
          </section>
        </div>
      </div>
    </div>
  );
}
