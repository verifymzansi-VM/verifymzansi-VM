import type { Metadata } from "next";
import { HomeProgrammeShowcase } from "@/components/home/home-programme-showcase";
import { SponsorStrip } from "@/components/organisations/sponsor-strip";
import { mzansiBusinessShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import { StreamedShowroom } from "@/components/showrooms/streamed-showroom";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/layout";
import { DisableMobileAutoplay } from "@/contexts/autoplay-policy-context";
import { MzansiBusinessGrid } from "./grid";
import { MzansiBusinessFilterSync } from "./filter-sync";
import { ListingGridSkeleton } from "@/components/listings/listing-skeleton";

import { BusinessDiscoveryBar } from "./discovery-bar";
import { BusinessFilterDrawer } from "@/components/listings/business-filter-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getRequiredVerifyMzansiCategorySeo } from "@/lib/seo/public-categories";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
const categorySeo = getRequiredVerifyMzansiCategorySeo("mzansi-business");

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

        {/* ── Card Carousel Showroom ─────────────── */}
        <StreamedShowroom
          feed="business"
          surface="showroom:business"
          hideFixtures={hideFixtures}
          emptyTitle="Mzansi Business"
          emptyDescription={categorySeo.description}
          emptyItem={{
            id: "mzansi-business-empty",
            type: "business",
            href: "/post/create-business",
            title: "Mzansi Business",
            description: categorySeo.description,
            location: "South Africa",
            mediaUrl: "/images/fallbacks/hero-business.svg",
          }}
          background={mzansiBusinessShowroomBackground}
        />

        {/* Programme partners: a separate band after the showroom, never inside it. */}
        <Suspense fallback={null}>
          <SponsorStrip />
        </Suspense>

        <Suspense fallback={null}>
          <HomeProgrammeShowcase placement="business" />
        </Suspense>

        {/* ── Main Content ─────────────────────────────────── */}
        <div className="container-page py-8 space-y-7 lg:py-10">
          {/* Compact mobile header */}
          <div className="flex items-center justify-between lg:hidden">
            <h1 className="font-display text-lg font-bold tracking-tight">Mzansi Business</h1>
            <Button asChild size="sm" className="h-11 gap-1">
              <Link href="/post/create-business">
                Add a business
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Mobile filter drawer (FAB visible < lg only) */}
          <BusinessFilterDrawer />

          <div className="flex gap-6 lg:gap-8">
            <aside className="hidden w-72 shrink-0 lg:block" aria-label="Business filters">
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
                breadcrumbs={[{ label: "Mzansi Business" }]}
                className="hidden lg:block"
              >
                <Button asChild size="sm" className="h-11 gap-2 elev-xs hover:elev-sm">
                  <Link href="/post/create-business">
                    Add a business
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
    </DisableMobileAutoplay>
  );
}
