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

  // Last resort: branded promotional banners when no promotions have photos
  if (sideCardItems.length === 0) {
    sideCardItems.push(...BRANDED_SIDE_CARD_FALLBACKS);
  }

  const hasEnoughItems = sideCardItems.length >= 1;
  const leftItems = sideCardItems;
  const rightItems = sideCardItems;

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
      <div className="lg:flex lg:items-center lg:gap-2 lg:px-2 lg:max-h-[480px] xl:gap-3 xl:px-3">
        <div className="hidden w-[15%] shrink-0 lg:block">
          <div className="aspect-[1/2] max-h-full w-full">
            <ShowroomSideCard items={leftItems} initialDelayMs={0} />
          </div>
        </div>
        <div className="min-w-0 lg:flex-1">{heroBannerNode}</div>
        <div className="hidden w-[15%] shrink-0 lg:block">
          <div className="aspect-[1/2] max-h-full w-full">
            <ShowroomSideCard items={rightItems} initialDelayMs={3000} />
          </div>
        </div>
      </div>
    </section>
  );
}
