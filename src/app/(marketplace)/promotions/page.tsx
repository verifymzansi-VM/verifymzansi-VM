import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  ShowroomCardCarousel,
  type CarouselItem,
} from "@/components/showrooms/showroom-card-carousel";
import {
  businessToCarouselItem,
  promotionToCarouselItem,
} from "@/components/showrooms/carousel-item-transforms";
import { TrustStrip } from "@/components/layout/trust-strip";
import { getOwnerColumn, withOwnerColumn } from "@/lib/account/compat";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";
import {
  buildPublicEventPromotionsQuery,
  buildPublicTourismBusinessesQuery,
} from "@/lib/promotions/public-tourism-events";

import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { PromotionsExplorer } from "./client";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export const metadata: Metadata = {
  title: "Tourism & Events",
  description: "Discover tourism destinations, accommodations, and events across South Africa.",
  alternates: {
    canonical: `${BASE_URL}/promotions`,
  },
};

export const revalidate = 60;

const CAROUSEL_ITEM_LIMIT = 5;

type TourismBusinessCarouselRow = {
  id: string;
  business_name: string;
  description?: string | null;
  cover_photo?: string | null;
  cover_video?: string | null;
  video_thumbnail?: string | null;
  logo_url?: string | null;
  location_city?: string | null;
  location_province?: string | null;
  focal_x?: number | null;
  focal_y?: number | null;
  media_width?: number | null;
  media_height?: number | null;
  boost_until?: string | null;
  featured_until?: string | null;
};

function buildBalancedCarouselItems(
  tourismItems: CarouselItem[],
  eventItems: CarouselItem[]
): CarouselItem[] {
  if (tourismItems.length === 0) return eventItems.slice(0, CAROUSEL_ITEM_LIMIT);
  if (eventItems.length === 0) return tourismItems.slice(0, CAROUSEL_ITEM_LIMIT);

  const balanced: CarouselItem[] = [];
  const tourismTarget = Math.min(tourismItems.length, Math.ceil(CAROUSEL_ITEM_LIMIT / 2));
  const eventTarget = Math.min(eventItems.length, CAROUSEL_ITEM_LIMIT - tourismTarget);

  balanced.push(...tourismItems.slice(0, tourismTarget));
  balanced.push(...eventItems.slice(0, eventTarget));

  if (balanced.length < CAROUSEL_ITEM_LIMIT) {
    balanced.push(
      ...tourismItems.slice(tourismTarget, tourismTarget + (CAROUSEL_ITEM_LIMIT - balanced.length))
    );
  }
  if (balanced.length < CAROUSEL_ITEM_LIMIT) {
    balanced.push(
      ...eventItems.slice(eventTarget, eventTarget + (CAROUSEL_ITEM_LIMIT - balanced.length))
    );
  }

  return balanced;
}

export default async function PromotionsPage() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();
  const promotionOwnerColumn = await getOwnerColumn(supabase, "promotions");
  const now = new Date().toISOString();

  // ── Fetch top tourism businesses for showroom hero ──
  const { data: tourismBusinesses } = await buildPublicTourismBusinessesQuery(supabase).limit(10);

  // ── Fetch top events for showroom hero ──
  const { data: topEvents } = await buildPublicEventPromotionsQuery(
    supabase,
    now,
    withOwnerColumn(
      "id, title, description, videos, photos, video_thumbnail, price_cents, location_province, location_city, promotion_type, boost_until, featured_until, business_id",
      promotionOwnerColumn
    )
  ).limit(10);

  // ── Build carousel items (tourism businesses + events) ──
  const tourismItems: CarouselItem[] = ((tourismBusinesses ?? []) as TourismBusinessCarouselRow[])
    .filter((b) => !shouldHidePlaywrightFixtureRowWhenEnabled(b, hideFixtures))
    .filter((b) => !isPlaceholderMarketplaceContent(b.business_name, b.description))
    .map((b) => businessToCarouselItem(b, `/mzansi-business/${b.id}`));

  const eventItems: CarouselItem[] = (
    (topEvents ?? []) as unknown as Array<{
      id: string;
      title: string;
      description?: string | null;
      videos?: string[] | null;
      photos?: string[] | null;
      video_thumbnail?: string | null;
      price_cents?: number | null;
      location_province?: string;
      location_city?: string;
      promotion_type?: string;
      boost_until?: string | null;
      featured_until?: string | null;
      business_id?: string | null;
      owner_id?: string | null;
      seller_id?: string | null;
    }>
  )
    .filter((p) => !shouldHidePlaywrightFixtureRowWhenEnabled(p, hideFixtures))
    .filter((p) => !isPlaceholderMarketplaceContent(p.title, p.description))
    .map((p) => promotionToCarouselItem(p, `/promotion/${p.id}`));

  const carouselItems: CarouselItem[] = buildBalancedCarouselItems(tourismItems, eventItems);

  if (carouselItems.length === 0) {
    carouselItems.push({
      id: "tourism-events-empty",
      type: "promotion",
      href: "/post/create-tourism",
      title: "Tourism & Events",
      description:
        "Discover tourism destinations, accommodations, and events from verified South African businesses.",
      location: "South Africa",
      mediaUrl: "/images/fallbacks/hero-shop.svg",
    });
  }

  return (
    <div className="space-y-0">
      {/* ── Card Carousel Showroom ── */}
      <ShowroomCardCarousel
        items={carouselItems}
        emptyTitle="Tourism & Events"
        emptyDescription="Discover tourism destinations, accommodations, and events from verified South African businesses."
      />

      <TrustStrip variant="green" />

      <Suspense fallback={null}>
        <PromotionsExplorer />
      </Suspense>
    </div>
  );
}
