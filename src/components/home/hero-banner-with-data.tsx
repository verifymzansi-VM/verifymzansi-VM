import { createClient } from "@supabase/supabase-js";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { ShowroomCardCarousel } from "@/components/showrooms/showroom-card-carousel";
import { generatedMzansiShowroomBackground } from "@/components/showrooms/showroom-backgrounds";
import {
  listingToCarouselItem,
  businessToCarouselItem,
  promotionToCarouselItem,
} from "@/components/showrooms/carousel-item-transforms";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Async server component that fetches hero data and renders the HeroBanner.
 * Designed to be wrapped in <Suspense> so the rest of the homepage streams immediately.
 */
export async function HeroBannerWithData() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const perAreaTarget = 5;
  const perAreaFetchLimit = 15;

  let topBusinesses = null;
  let latestListings = null;
  let latestPromotions = null;

  if (url && anonKey && isValidHttpUrl(url)) {
    const supabase = createClient(url, anonKey);

    const [businesses, listings, promotions] = await Promise.all([
      applyVisibleExpiryFilter(
        supabase
          .from("businesses")
          .select(
            "id, business_name, logo_url, cover_photo, cover_video, video_thumbnail, description, location_city, location_province, focal_x, focal_y, media_width, media_height"
          )
          .eq("status", "live")
      )
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(perAreaFetchLimit),
      applyVisibleExpiryFilter(
        supabase
          .from("listings")
          .select(
            "id, title, description, price_cents, photos, videos, video_thumbnail, logo_url, location_city, location_province, category, focal_x, focal_y, media_width, media_height"
          )
          .eq("status", "live")
          .eq("area", "MZANSI_MARKET")
      )
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(perAreaFetchLimit),
      applyVisibleExpiryFilter(
        supabase
          .from("promotions")
          .select(
            "id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, location_city, location_province, price_cents, focal_x, focal_y, media_width, media_height"
          )
          .eq("status", "live")
      )
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("featured_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(perAreaFetchLimit),
    ]);

    topBusinesses = (businesses.data || [])
      .filter(
        (business) => !isPlaceholderMarketplaceContent(business.business_name, business.description)
      )
      .slice(0, perAreaTarget);
    latestListings = (listings.data || [])
      .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
      .slice(0, perAreaTarget);
    latestPromotions = (promotions.data || [])
      .filter(
        (promotion) => !isPlaceholderMarketplaceContent(promotion.title, promotion.description)
      )
      .slice(0, perAreaTarget);
  }

  // Build mixed carousel items from all three content types
  const carouselItems = [
    ...(topBusinesses || []).map((b) => businessToCarouselItem(b)),
    ...(latestListings || []).map((l) => listingToCarouselItem(l)),
    ...(latestPromotions || []).map((p) => promotionToCarouselItem(p)),
  ];

  return (
    <ShowroomCardCarousel
      items={carouselItems}
      emptyTitle="Welcome to VerifyMzansi"
      emptyDescription="Explore business profiles, listings, tourism, and events across South Africa."
      emptyMediaUrl="/images/fallbacks/hero-home.svg"
      background={generatedMzansiShowroomBackground}
    />
  );
}
