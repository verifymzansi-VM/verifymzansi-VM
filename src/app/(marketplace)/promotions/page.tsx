import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { type ShowroomSlide } from "@/components/showrooms/showroom-hero";
import { ShowroomWithSideCards } from "@/components/showrooms/showroom-with-side-cards";
import { type SideCardItem } from "@/components/showrooms/showroom-side-card";
import { TrustStrip } from "@/components/layout/trust-strip";
import { getOwnerColumn, withOwnerColumn } from "@/lib/account/compat";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { isPlaceholderMarketplaceContent } from "@/lib/utils/placeholder-content";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "@/components/home/playwright-fixture-filter";
import { BRANDED_SIDE_CARD_FALLBACKS } from "@/components/showrooms/side-card-fallbacks";
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

type PromotionSideCardRow = {
  id: string;
  title?: string | null;
  photos?: string[] | null;
  owner_id?: string | null;
  seller_id?: string | null;
};

const SHOWROOM_SLIDE_LIMIT = 5;

function buildBalancedShowroomSlides(
  tourismSlides: ShowroomSlide[],
  eventSlides: ShowroomSlide[]
): ShowroomSlide[] {
  if (tourismSlides.length === 0) {
    return eventSlides.slice(0, SHOWROOM_SLIDE_LIMIT);
  }

  if (eventSlides.length === 0) {
    return tourismSlides.slice(0, SHOWROOM_SLIDE_LIMIT);
  }

  const balancedSlides: ShowroomSlide[] = [];
  const tourismTarget = Math.min(tourismSlides.length, Math.ceil(SHOWROOM_SLIDE_LIMIT / 2));
  const eventTarget = Math.min(eventSlides.length, SHOWROOM_SLIDE_LIMIT - tourismTarget);

  balancedSlides.push(...tourismSlides.slice(0, tourismTarget));
  balancedSlides.push(...eventSlides.slice(0, eventTarget));

  if (balancedSlides.length < SHOWROOM_SLIDE_LIMIT) {
    const remainingTourism = tourismSlides.slice(tourismTarget);
    const remainingEvents = eventSlides.slice(eventTarget);

    balancedSlides.push(...remainingTourism.slice(0, SHOWROOM_SLIDE_LIMIT - balancedSlides.length));

    if (balancedSlides.length < SHOWROOM_SLIDE_LIMIT) {
      balancedSlides.push(
        ...remainingEvents.slice(0, SHOWROOM_SLIDE_LIMIT - balancedSlides.length)
      );
    }
  }

  return balancedSlides;
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
  const { data: tourismBusinesses } = await supabase
    .from("businesses")
    .select("*")
    .eq("status", "live")
    .eq("category", "tourism_hospitality")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  // ── Fetch top events for showroom hero ──
  const { data: topEvents } = await supabase
    .from("promotions")
    .select(
      withOwnerColumn(
        "id, title, description, videos, photos, video_thumbnail, price_cents, location_province, location_city, promotion_type, boost_until, featured_until, business_id",
        promotionOwnerColumn
      )
    )
    .eq("status", "live")
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  // ── Build showroom slides (tourism businesses + events) ──
  const tourismSlides: ShowroomSlide[] = (tourismBusinesses ?? [])
    .filter((b) => !shouldHidePlaywrightFixtureRowWhenEnabled(b, hideFixtures))
    .filter((b) => !isPlaceholderMarketplaceContent(b.business_name, b.description))
    .map((b) => ({
      type: "business" as const,
      id: b.id,
      title: b.business_name,
      description: b.description || "Verified South African tourism business.",
      location: b.location_city || b.location_province || "South Africa",
      mediaUrl: normalizeMediaUrl(
        b.cover_video || b.cover_photo || "/images/fallbacks/hero-business.svg"
      ),
      posterUrl: b.video_thumbnail
        ? normalizeMediaUrl(b.video_thumbnail)
        : b.cover_photo
          ? normalizeMediaUrl(b.cover_photo)
          : undefined,
      hrefOverride: `/mzansi-business/${b.id}`,
    }));

  const eventSlides: ShowroomSlide[] = (
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
    .map((p) => ({
      type: "promotion" as const,
      id: p.id,
      title: p.title,
      description: p.description || "Discover exciting events across South Africa.",
      location: p.location_city || p.location_province || "South Africa",
      mediaUrl: normalizeMediaUrl(
        p.videos?.[0] || p.photos?.[0] || "/images/fallbacks/hero-listing.svg"
      ),
      posterUrl: p.video_thumbnail
        ? normalizeMediaUrl(p.video_thumbnail)
        : p.photos?.[0]
          ? normalizeMediaUrl(p.photos[0])
          : undefined,
      price: p.price_cents ? p.price_cents / 100 : null,
      hrefOverride: `/promotion/${p.id}`,
      ctaLabelOverride: "View Event",
      badgeLabelOverride: "Tourism & Events",
    }));

  const slides: ShowroomSlide[] = buildBalancedShowroomSlides(tourismSlides, eventSlides);

  if (slides.length === 0) {
    slides.push({
      id: "tourism-events-empty",
      type: "promotion",
      title: "Tourism & Events",
      description:
        "Discover tourism destinations, accommodations, and events from verified South African businesses.",
      location: "South Africa",
      mediaUrl: "/images/fallbacks/hero-shop.svg",
      hrefOverride: "/post/create-tourism",
      ctaLabelOverride: "Create Event",
      badgeLabelOverride: "Tourism & Events",
    });
  }

  // ── Fetch side card items ──
  const { data: sideCardPromos } = await supabase
    .from("promotions")
    .select(withOwnerColumn("id, title, photos, owner_id", promotionOwnerColumn))
    .eq("status", "live")
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(10);

  const sideCardItems: SideCardItem[] = (
    (sideCardPromos ?? []) as unknown as PromotionSideCardRow[]
  )
    .filter((promotion) => !shouldHidePlaywrightFixtureRowWhenEnabled(promotion, hideFixtures))
    .filter((promotion) => !isPlaceholderMarketplaceContent(promotion.title))
    .filter((p) => p.photos && p.photos.length > 0)
    .map((p) => ({ id: p.id, imageUrl: normalizeMediaUrl(p.photos![0]) }));

  if (sideCardItems.length === 0) {
    sideCardItems.push(...BRANDED_SIDE_CARD_FALLBACKS);
  }

  return (
    <div className="space-y-0">
      {/* ── Dynamic Showroom Hero with side ad cards ── */}
      <ShowroomWithSideCards
        slides={slides}
        fallbackTitle="Tourism & Events Showroom"
        fallbackDescription="Discover tourism destinations, accommodations, and events from verified South African businesses."
        sideCardItems={sideCardItems}
      />

      <TrustStrip variant="green" />

      <Suspense fallback={null}>
        <PromotionsExplorer />
      </Suspense>
    </div>
  );
}
