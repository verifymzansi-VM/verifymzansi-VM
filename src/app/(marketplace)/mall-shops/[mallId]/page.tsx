import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Image from "next/image";
import { MapPin, Building2, Store } from "lucide-react";
import { MallShopCard } from "@/components/listings/mall-shop-card";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

interface PageProps {
  params: Promise<{ mallId: string }>;
}

export default async function MallProfilePage({ params }: PageProps) {
  const { mallId } = await params;
  const supabase = await createClient();

  // Fetch the mall
  const { data: mall, error: mallError } = await supabase
    .from("malls")
    .select("*")
    .eq("id", mallId)
    .single();

  if (mallError || !mall) {
    notFound();
  }

  // Fetch storefronts for this mall
  const { data: storefronts } = await supabase
    .from("storefronts")
    .select(
      `
      id,
      mall_name,
      description,
      cover_photo,
      logo_url,
      category,
      location_province,
      location_city,
      seller_id
    `
    )
    .eq("mall_id", mallId)
    .eq("status", "live")
    .order("created_at", { ascending: false });

  const shops = storefronts || [];

  // Fetch sellers
  const sellerIds = Array.from(new Set(shops.map((s) => s.seller_id).filter(Boolean)));
  let sellers: { user_id: string; display_name: string; seller_verification_status: string }[] = [];
  if (sellerIds.length > 0) {
    const { data } = await supabase
      .from("seller_profiles")
      .select("user_id, display_name, seller_verification_status")
      .in("user_id", sellerIds);
    sellers = data || [];
  }
  const sellerMap = new Map((sellers ?? []).map((s) => [s.user_id, s]));

  return (
    <div className="container-page py-6 space-y-8">
      {/* Mall Hero */}
      <div className="rounded-2xl overflow-hidden bg-card border shadow-sm relative">
        <div className="h-48 md:h-64 bg-gradient-to-br from-brand-gold-50 to-brand-gold-100 dark:from-brand-gold-950 dark:to-brand-gold-900 relative">
          {mall.cover_photo ? (
            <Image
              src={normalizeMediaUrl(mall.cover_photo)}
              alt={mall.name}
              fill
              className="object-cover"
              sizes="100vw"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center opacity-10">
              <Building2 className="w-24 h-24" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

          <div className="absolute bottom-0 left-0 p-6 md:p-8 text-white">
            <h1 className="text-3xl md:text-4xl font-display font-bold mb-2 text-white">
              {mall.name}
            </h1>
            <div className="flex items-center gap-4 text-white/90">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <MapPin className="h-4 w-4" />
                <span>
                  {mall.location_city ? `${mall.location_city}, ` : ""}
                  {mall.location_province}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Store className="h-4 w-4" />
                <span>
                  {shops.length} {shops.length === 1 ? "Shop" : "Shops"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Shops Grid */}
      <div className="space-y-6">
        <h2 className="text-2xl font-display font-bold">Shops in {mall.name}</h2>

        {shops.length === 0 ? (
          <div className="text-center py-16 space-y-3 bg-card border rounded-xl">
            <Store className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="text-lg font-medium">No active shops yet</p>
            <p className="text-sm text-muted-foreground">
              This mall currently doesn&apos;t have any verified storefronts.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {shops.map((shop) => {
              const seller = sellerMap.get(shop.seller_id);
              const trustLevel = computeTrustLevel(
                (seller?.seller_verification_status as Parameters<typeof computeTrustLevel>[0]) ??
                  "incomplete"
              );

              return (
                <MallShopCard
                  key={shop.id}
                  id={shop.id}
                  name={shop.mall_name}
                  description={shop.description || undefined}
                  coverPhoto={shop.cover_photo}
                  logoUrl={shop.logo_url}
                  province={shop.location_province}
                  city={shop.location_city}
                  trustLevel={trustLevel}
                  category={shop.category}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
