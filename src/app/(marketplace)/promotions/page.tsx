import type { Metadata } from "next";
import { HomeProgrammeShowcase } from "@/components/home/home-programme-showcase";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  ShowroomCardCarousel,
  type CarouselItem,
} from "@/components/showrooms/showroom-card-carousel";
import { tourismEventsShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import { DisableMobileAutoplay } from "@/contexts/autoplay-policy-context";
import { loadShowroomItems, type ShowroomClient } from "@/lib/showroom/feed";
import { getVisitorProvince } from "@/lib/showroom/visitor-province";

import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { PromotionsExplorer } from "./client";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";
import { getRequiredVerifyMzansiCategorySeo } from "@/lib/seo/public-categories";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";
const categorySeo = getRequiredVerifyMzansiCategorySeo("tourism-events");

export const metadata: Metadata = {
  title: categorySeo.title,
  description: categorySeo.description,
  alternates: {
    canonical: `${BASE_URL}/tourism-events`,
  },
  openGraph: {
    title: categorySeo.title,
    description: categorySeo.description,
    url: `${BASE_URL}/tourism-events`,
  },
};

export const revalidate = 60;

export default async function PromotionsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: categorySeo.searchName,
    alternateName: categorySeo.name,
    url: `${BASE_URL}/tourism-events`,
    description: categorySeo.searchSummary,
    isPartOf: {
      "@type": "WebSite",
      name: "VerifyMzansi",
      url: BASE_URL,
    },
    about: ["tourism", "accommodation", "experiences", "events", "South Africa"],
  };
  const cookieStore = await getOptionalCookieStore();
  const hideFixtures = shouldHidePlaywrightFixtures(
    readCookieValue(cookieStore, PLAYWRIGHT_HIDE_FIXTURES_COOKIE)
  );
  const supabase = await createClient();
  const visitor = await getVisitorProvince();
  // Tourism businesses and events share one fair rotation.
  const carouselItems: CarouselItem[] = await loadShowroomItems("tourism", {
    province: visitor.province,
    hideFixtures,
    client: supabase as unknown as ShowroomClient,
  });

  if (carouselItems.length === 0) {
    carouselItems.push({
      id: "tourism-events-empty",
      type: "promotion",
      href: "/post/create-tourism",
      title: "Tourism & Events",
      description: categorySeo.description,
      location: "South Africa",
      mediaUrl: "/images/fallbacks/hero-shop.svg",
    });
  }

  return (
    <DisableMobileAutoplay>
      <div className="space-y-0">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
        />
        {/* ── Card Carousel Showroom ── */}
        <ShowroomCardCarousel
          items={carouselItems}
          surface="showroom:tourism"
          visitorProvince={visitor}
          emptyTitle="Tourism & Events"
          emptyDescription={categorySeo.description}
          background={tourismEventsShowroomBackground}
        />

        <Suspense fallback={null}>
          <HomeProgrammeShowcase placement="tourism" />
        </Suspense>

        <Suspense fallback={null}>
          <PromotionsExplorer />
        </Suspense>
      </div>
    </DisableMobileAutoplay>
  );
}
