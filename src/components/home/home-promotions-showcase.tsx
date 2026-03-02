import Link from "next/link";
import { Megaphone, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromotionCard } from "@/components/listings/promotion-card";
import { createClient } from "@supabase/supabase-js";
import type { PromotionType } from "@/types/enums";

interface PromotionRow {
  id: string;
  title: string;
  price_cents: number | null;
  price_negotiable: boolean;
  photos: string[] | null;
  location_province: string;
  location_city: string;
  promotion_type: string;
  view_count: number;
  boost_until: string | null;
  featured_until: string | null;
  end_date: string | null;
  created_at: string;
}

export async function HomePromotionsShowcase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  const supabase = createClient(url, anonKey);
  const now = new Date().toISOString();

  const { data } = await supabase
    .from("promotions")
    .select(
      "id, title, price_cents, price_negotiable, photos, location_province, location_city, promotion_type, view_count, boost_until, featured_until, end_date, created_at"
    )
    .eq("status", "live")
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(6);

  const promotions = (data || []) as PromotionRow[];

  if (promotions.length === 0) return null;

  return (
    <section className="py-8 sm:py-12 border-b border-warm-200 dark:border-warm-800 bg-gradient-to-b from-red-50/30 to-white dark:from-red-950/10 dark:to-warm-950">
      <div className="container-page space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-red-500" />
            <h2 className="font-display text-xl sm:text-2xl font-bold">Promotions & Ads</h2>
          </div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1 text-red-600 hover:text-red-700"
          >
            <Link href="/promotions">
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {promotions.map((promo) => (
            <PromotionCard
              key={promo.id}
              id={promo.id}
              title={promo.title}
              price={promo.price_cents}
              negotiable={promo.price_negotiable}
              imageUrl={promo.photos?.[0]}
              province={promo.location_province}
              city={promo.location_city}
              promotionType={promo.promotion_type as PromotionType}
              createdAt={promo.created_at}
              viewCount={promo.view_count}
              boosted={promo.boost_until ? new Date(promo.boost_until) > new Date(now) : false}
              featured={
                promo.featured_until ? new Date(promo.featured_until) > new Date(now) : false
              }
              endDate={promo.end_date}
            />
          ))}
        </div>

        <div className="text-center">
          <Button asChild variant="outline" className="gap-1">
            <Link href="/post/create-promotion">
              <Megaphone className="h-4 w-4" />
              Create Your Ad
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
