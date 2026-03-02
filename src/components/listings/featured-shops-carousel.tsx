import { createClient } from "@/lib/supabase/server";
import { Store } from "lucide-react";
import { MallShopCard } from "@/components/listings/mall-shop-card";

interface ShopRow {
  id: string;
  mall_name: string;
  description: string;
  logo_url: string | null;
  cover_image_url: string | null;
  category: string;
  malls: { location_province: string; location_city: string };
}

export async function FeaturedShopsCarousel() {
  const supabase = await createClient();
  const now = new Date().toISOString();

  // Prioritise boosted shops, then fall back to newest live shops
  const { data: boostedShops } = await supabase
    .from("storefronts")
    .select(
      `
      id,
      mall_name,
      description,
      logo_url,
      cover_image_url,
      category,
      malls!inner (location_province, location_city)
    `
    )
    .not("mall_id", "is", null)
    .eq("status", "live")
    .gt("boost_until", now)
    .order("boost_until", { ascending: false })
    .limit(8);

  // If we don't have enough boosted shops, fill with newest
  const boostedIds = (boostedShops ?? []).map((s) => s.id);
  const remaining = 8 - boostedIds.length;

  let fallbackShops: typeof boostedShops = [];
  if (remaining > 0) {
    const query = supabase
      .from("storefronts")
      .select(
        `
        id,
        mall_name,
        description,
        logo_url,
        cover_image_url,
        category,
        malls!inner (location_province, location_city)
      `
      )
      .not("mall_id", "is", null)
      .eq("status", "live")
      .order("created_at", { ascending: false })
      .limit(remaining);

    // Exclude already-fetched boosted shops
    if (boostedIds.length > 0) {
      query.not("id", "in", `(${boostedIds.join(",")})`);
    }

    const { data } = await query;
    fallbackShops = data ?? [];
  }

  const shops = [...(boostedShops ?? []), ...fallbackShops];
  const hasBoosted = (boostedShops ?? []).length > 0;

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Store className="w-5 h-5 text-brand-gold-700" />
        <h2 className="text-xl font-display font-semibold">
          {hasBoosted ? "Featured Shops" : "Newest Shops inside Malls"}
        </h2>
      </div>

      {!shops || shops.length === 0 ? (
        <div className="px-1 py-8 text-center bg-muted/30 border border-dashed rounded-xl">
          <p className="text-sm text-muted-foreground">
            No featured shops available right now. Check back soon!
          </p>
        </div>
      ) : (
        <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 px-1 -mx-1 hide-scrollbar">
          {}
          {(shops as unknown as ShopRow[]).map((shop) => (
            <div key={shop.id} className="snap-start shrink-0 w-[280px] sm:w-[320px]">
              <MallShopCard
                id={shop.id}
                name={shop.mall_name}
                description={shop.description}
                coverPhoto={shop.cover_image_url}
                logoUrl={shop.logo_url}
                province={shop.malls.location_province}
                city={shop.malls.location_city}
                category={shop.category}
                trustLevel={0}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
