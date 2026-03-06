import { createClient } from "@supabase/supabase-js";
import { HeroBanner } from "./hero-banner";

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
          "id, business_name, cover_photo, cover_video, video_thumbnail, description, location_city"
        )
        .eq("status", "live")
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("listings")
        .select(
          "id, title, description, price_cents, photos, videos, video_thumbnail, location_city, category"
        )
        .eq("status", "live")
        .eq("area", "MZANSI_MARKET")
        .order("featured", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("promotions")
        .select(
          "id, title, description, promotion_type, category, category_key, photos, videos, video_thumbnail, location_city, price_cents"
        )
        .eq("status", "live")
        .order("boost_until", { ascending: false, nullsFirst: false })
        .order("featured_until", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    topBusinesses = businesses.data;
    latestListings = listings.data;
    latestPromotions = promotions.data;
  }

  return (
    <HeroBanner
      topBusinesses={topBusinesses || []}
      latestListings={latestListings || []}
      latestPromotions={latestPromotions || []}
    />
  );
}
