import { createClient } from "@supabase/supabase-js";
import { HeroBanner } from "./hero-banner";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { ShowroomSideCard, type SideCardItem } from "@/components/showrooms/showroom-side-card";
import { normalizeMediaUrl } from "@/lib/utils/media-url";
import { BRANDED_SIDE_CARD_FALLBACKS } from "@/components/showrooms/side-card-fallbacks";

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

  let topBusinesses = null;
  let latestListings = null;
  let latestPromotions = null;

  if (url && anonKey && isValidHttpUrl(url)) {
    const supabase = createClient(url, anonKey);

    const [businesses, listings, promotions] = await Promise.all([
      supabase
        .from("businesses")
        .select(
          "id, business_name, logo_url, cover_photo, cover_video, video_thumbnail, description, location_city"
        )
        .eq("status", "live")
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(9),
      supabase
        .from("listings")
        .select(
          "id, title, description, price_cents, photos, videos, video_thumbnail, logo_url, location_city, category"
        )
        .eq("status", "live")
        .eq("area", "MZANSI_MARKET")
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(9),
      supabase
        .from("promotions")
        .select(
          "id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, location_city, price_cents"
        )
        .eq("status", "live")
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("featured_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(9),
    ]);

    topBusinesses = (businesses.data || [])
      .filter(
        (business) => !isPlaceholderMarketplaceContent(business.business_name, business.description)
      )
      .slice(0, 3);
    latestListings = (listings.data || [])
      .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
      .slice(0, 3);
    latestPromotions = (promotions.data || [])
      .filter(
        (promotion) => !isPlaceholderMarketplaceContent(promotion.title, promotion.description)
      )
      .slice(0, 3);
  }

  // Extract side-card items from promotions that have cover photos
  const sideCardItems: SideCardItem[] = (latestPromotions || []).flatMap((p) => {
    const promo = p as { id: string; photos?: string[] | null };
    const photo = promo.photos?.[0];
    if (!photo) return [];
    const imageUrl = normalizeMediaUrl(photo);
    return imageUrl ? [{ id: promo.id, imageUrl }] : [];
  });

  // Fallback: fill from listings when promotions don't provide enough images
  if (sideCardItems.length < 2) {
    const listingFallbacks: SideCardItem[] = (latestListings || []).flatMap((l) => {
      const listing = l as { id: string; photos?: string[] | null };
      const photo = listing.photos?.[0];
      if (!photo) return [];
      const imageUrl = normalizeMediaUrl(photo);
      return imageUrl ? [{ id: listing.id, imageUrl }] : [];
    });
    sideCardItems.push(...listingFallbacks.slice(0, 6 - sideCardItems.length));
  }

  // Second fallback: fill from businesses
  if (sideCardItems.length < 2) {
    const bizFallbacks: SideCardItem[] = (topBusinesses || []).flatMap((b) => {
      const biz = b as { id: string; cover_photo?: string | null };
      if (!biz.cover_photo) return [];
      const imageUrl = normalizeMediaUrl(biz.cover_photo);
      return imageUrl ? [{ id: biz.id, imageUrl }] : [];
    });
    sideCardItems.push(...bizFallbacks.slice(0, 6 - sideCardItems.length));
  }

  // Last resort: branded promotional banners
  if (sideCardItems.length < 2) {
    sideCardItems.push(...BRANDED_SIDE_CARD_FALLBACKS.slice(0, 4 - sideCardItems.length));
  }

  const hasEnoughItems = sideCardItems.length >= 1;
  const leftItems =
    sideCardItems.length === 1 ? sideCardItems : sideCardItems.filter((_, i) => i % 2 === 0);
  const rightItems =
    sideCardItems.length === 1 ? sideCardItems : sideCardItems.filter((_, i) => i % 2 !== 0);

  const heroBannerNode = (
    <HeroBanner
      topBusinesses={topBusinesses || []}
      latestListings={latestListings || []}
      latestPromotions={latestPromotions || []}
    />
  );

  if (!hasEnoughItems) {
    return heroBannerNode;
  }

  return (
    <section className="w-full">
      <div className="lg:flex lg:items-stretch lg:gap-2 lg:px-2 xl:gap-3 xl:px-3">
        <div className="hidden w-[15%] shrink-0 self-stretch lg:block">
          <div className="h-full">
            <ShowroomSideCard items={leftItems} initialDelayMs={0} />
          </div>
        </div>
        <div className="min-w-0 lg:flex-1">{heroBannerNode}</div>
        <div className="hidden w-[15%] shrink-0 self-stretch lg:block">
          <div className="h-full">
            <ShowroomSideCard items={rightItems} initialDelayMs={2500} />
          </div>
        </div>
      </div>
    </section>
  );
}
