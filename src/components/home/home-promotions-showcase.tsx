import Link from "next/link";
import { cookies } from "next/headers";
import { Megaphone, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromotionCard } from "@/components/listings/promotion-card";
import { createClient } from "@/lib/supabase/server";
import { AutoScrollRail } from "./auto-scroll-rail";
import type { BusinessCategory, PromotionType } from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "./playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";

interface PromotionRow {
  id: string;
  title: string;
  price_cents: number | null;
  price_negotiable: boolean;
  photos: string[] | null;
  videos: string[] | null;
  video_thumbnail: string | null;
  category: string | null;
  category_key: BusinessCategory | null;
  location_province: string;
  location_city: string;
  promotion_type: string;
  view_count: number;
  boost_until: string | null;
  featured_until: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  business_id: string | null;
}

export async function HomePromotionsShowcase() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data } = await supabase
    .from("promotions")
    .select("*")
    .eq("status", "live")
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(12);

  const promotions = ((data || []) as PromotionRow[])
    .filter((promotion) => !shouldHidePlaywrightFixtureRowWhenEnabled(promotion, hideFixtures))
    .filter((promotion) => !isPlaceholderMarketplaceContent(promotion.title))
    .slice(0, 6);

  // Fetch business logos for promotions linked to a business
  const businessIds = [
    ...new Set(promotions.map((p) => p.business_id).filter(Boolean)),
  ] as string[];
  const { data: businesses } = businessIds.length
    ? await supabase.from("businesses").select("id, logo_url").in("id", businessIds)
    : { data: [] };
  const logoMap = new Map((businesses ?? []).map((b) => [b.id, b.logo_url as string | null]));

  if (promotions.length === 0) {
    return (
      <section className="py-4 sm:py-6 bg-gradient-to-b from-red-50/30 to-white dark:from-red-950/10 dark:to-warm-950">
        <div className="container-page space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Megaphone className="h-6 w-6 text-red-500" />
              <h2 className="font-display text-xl sm:text-2xl font-bold">Promotions & Events</h2>
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-warm-300 dark:border-warm-700 bg-warm-50 dark:bg-warm-900 p-8 text-center space-y-3">
            <Megaphone className="h-10 w-10 text-red-400/50 mx-auto" />
            <p className="text-muted-foreground text-sm">
              No promotions yet. Be the first to post a promotion or event.
            </p>
            <Button
              asChild
              size="sm"
              className="bg-red-700 hover:bg-red-800 text-white rounded-full"
            >
              <Link href="/post/create-promotion">
                Create Promotion
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-4 sm:py-6 bg-gradient-to-b from-red-50/30 to-white dark:from-red-950/10 dark:to-warm-950">
      <div className="container-page space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-red-500" />
            <h2 className="font-display text-xl sm:text-2xl font-bold">Promotions & Events</h2>
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

        <AutoScrollRail ariaLabel="Promotions and ads">
          {promotions.map((promo, index) => (
            <div
              key={promo.id}
              className="min-w-[280px] max-w-[320px] sm:min-w-[300px] sm:max-w-[320px]"
            >
              <PromotionCard
                id={promo.id}
                title={promo.title}
                price={promo.price_cents}
                negotiable={promo.price_negotiable}
                imageUrl={promo.videos?.[0] || promo.photos?.[0]}
                posterUrl={promo.video_thumbnail || promo.photos?.[0] || undefined}
                categoryLabel={getPromotionCategoryDisplayLabel(promo.category_key, promo.category)}
                province={promo.location_province}
                city={promo.location_city}
                promotionType={promo.promotion_type as PromotionType}
                createdAt={promo.created_at}
                viewCount={promo.view_count}
                boosted={promo.boost_until ? new Date(promo.boost_until) > new Date(now) : false}
                featured={
                  promo.featured_until ? new Date(promo.featured_until) > new Date(now) : false
                }
                startDate={promo.start_date}
                endDate={promo.end_date}
                logoUrl={promo.business_id ? logoMap.get(promo.business_id) : undefined}
                priority={index === 0}
              />
            </div>
          ))}
        </AutoScrollRail>
      </div>
    </section>
  );
}
