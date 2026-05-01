import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  ShowroomCardCarousel,
  type CarouselItem,
} from "@/components/showrooms/showroom-card-carousel";
import {
  businessToCarouselItem,
  promotionToCarouselItem,
} from "@/components/showrooms/carousel-item-transforms";
import { tourismEventsShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
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
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export const metadata: Metadata = {
  title: "Tourism & Events",
  description: "Discover tourism destinations, accommodations, and events across South Africa.",
  alternates: {
    canonical: `${BASE_URL}/tourism-events`,
  },
};

export const revalidate = 60;

const CAROUSEL_ITEM_LIMIT = 7;

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
  category?: string | null;
};

type QueryDataResult<T> = {
  data: T[] | null;
};

async function getPublicPromotionOwnerColumn(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<"owner_id" | "seller_id"> {
  try {
    return await getOwnerColumn(supabase, "promotions");
  } catch {
    return "owner_id";
  }
}

async function getPublicCarouselRows<T>(
  query: { limit: (count: number) => PromiseLike<QueryDataResult<T>> },
  limit: number
): Promise<T[]> {
  try {
    const { data } = await query.limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}

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
  const cookieStore = await getOptionalCookieStore();
  const hideFixtures = shouldHidePlaywrightFixtures(
    readCookieValue(cookieStore, PLAYWRIGHT_HIDE_FIXTURES_COOKIE)
  );
  const supabase = await createClient();
  const promotionOwnerColumn = await getPublicPromotionOwnerColumn(supabase);
  const now = new Date().toISOString();

  // ── Fetch top tourism businesses for showroom hero ──
  const tourismBusinesses = await getPublicCarouselRows<unknown>(
    buildPublicTourismBusinessesQuery(supabase),
    10
  );

  // ── Fetch top events for showroom hero ──
  const topEvents = await getPublicCarouselRows<unknown>(
    buildPublicEventPromotionsQuery(
      supabase,
      now,
      withOwnerColumn(
        "id, title, description, videos, photos, video_thumbnail, price_cents, location_province, location_city, promotion_type, boost_until, featured_until, business_id",
        promotionOwnerColumn
      )
    ),
    10
  );

  // ── Build carousel items (tourism businesses + events) ──
  const tourismRows = (tourismBusinesses ?? []) as unknown as TourismBusinessCarouselRow[];

  const tourismItems: CarouselItem[] = tourismRows
    .filter((b) => !shouldHidePlaywrightFixtureRowWhenEnabled(b, hideFixtures))
    .filter((b) => !isPlaceholderMarketplaceContent(b.business_name, b.description))
    .map((b) => businessToCarouselItem({ ...b, category: b.category ?? "tourism_hospitality" }));

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
    .map((p) => promotionToCarouselItem(p, `/tourism-events/${p.id}`));

  const carouselItems: CarouselItem[] = buildBalancedCarouselItems(tourismItems, eventItems);

  if (carouselItems.length === 0) {
    carouselItems.push({
      id: "tourism-events-empty",
      type: "promotion",
      href: "/post/create-tourism",
      title: "Tourism & Events",
      description:
        "Discover tourism destinations, accommodations, and events from South African hosts and businesses.",
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
        emptyDescription="Discover tourism destinations, accommodations, and events from South African hosts and businesses."
        background={tourismEventsShowroomBackground}
      />

      <TrustStrip variant="green" title="Latest Tourism & Events" />

      <Suspense fallback={null}>
        <PromotionsExplorer />
      </Suspense>
    </div>
  );
}
