import Link from "next/link";
import { cookies } from "next/headers";
import { TreePalm, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromotionCard } from "@/components/listings/promotion-card";
import { BusinessPreviewCard } from "@/components/home/business-preview-card";
import { createClient } from "@/lib/supabase/server";
import { AutoScrollRail } from "./auto-scroll-rail";
import type { BusinessCategory, BusinessType, PromotionType } from "@/types/enums";
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

interface TourismBusinessRow {
  id: string;
  business_name: string;
  business_type: string;
  cover_photo: string | null;
  cover_video: string | null;
  video_thumbnail: string | null;
  logo_url: string | null;
  location_province: string;
  location_city: string;
  boost_until: string | null;
  featured_until: string | null;
  focal_x: number | null;
  focal_y: number | null;
}

type ShowcaseItem =
  | { kind: "event"; data: PromotionRow }
  | { kind: "tourism"; data: TourismBusinessRow };

export async function HomePromotionsShowcase() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();
  const now = new Date().toISOString();

  // Fetch events
  const { data: eventData } = await supabase
    .from("promotions")
    .select("*")
    .eq("status", "live")
    .eq("promotion_type", "event")
    .or(`end_date.is.null,end_date.gte.${now}`)
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(8);

  const promotions = ((eventData || []) as PromotionRow[])
    .filter((promotion) => !shouldHidePlaywrightFixtureRowWhenEnabled(promotion, hideFixtures))
    .filter((promotion) => !isPlaceholderMarketplaceContent(promotion.title))
    .slice(0, 4);

  // Fetch tourism businesses
  const { data: tourismData } = await supabase
    .from("businesses")
    .select(
      "id, business_name, business_type, cover_photo, cover_video, video_thumbnail, logo_url, location_province, location_city, boost_until, featured_until, focal_x, focal_y"
    )
    .eq("category", "tourism_hospitality")
    .in("status", ["live", "active"])
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured_until", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(8);

  const tourismBusinesses = ((tourismData || []) as TourismBusinessRow[])
    .filter((b) => !shouldHidePlaywrightFixtureRowWhenEnabled(b, hideFixtures))
    .filter((b) => !isPlaceholderMarketplaceContent(b.business_name))
    .slice(0, 4);

  // Fetch business logos for promotions linked to a business
  const businessIds = [
    ...new Set(promotions.map((p) => p.business_id).filter(Boolean)),
  ] as string[];
  const { data: businesses } = businessIds.length
    ? await supabase.from("businesses").select("id, logo_url").in("id", businessIds)
    : { data: [] };
  const logoMap = new Map((businesses ?? []).map((b) => [b.id, b.logo_url as string | null]));

  // Interleave tourism and events
  const items: ShowcaseItem[] = [];
  const maxLen = Math.max(tourismBusinesses.length, promotions.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < tourismBusinesses.length) items.push({ kind: "tourism", data: tourismBusinesses[i] });
    if (i < promotions.length) items.push({ kind: "event", data: promotions[i] });
  }

  if (items.length === 0) {
    return (
      <section className="py-4 sm:py-6 bg-gradient-to-b from-teal-50/30 to-white dark:from-teal-950/10 dark:to-warm-950">
        <div className="container-page space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TreePalm className="h-6 w-6 text-teal-500" />
              <h2 className="font-display text-xl sm:text-2xl font-bold">Tourism & Events</h2>
            </div>
          </div>
          <div className="rounded-2xl border border-dashed border-warm-300 dark:border-warm-700 bg-warm-50 dark:bg-warm-900 p-8 text-center space-y-3">
            <TreePalm className="h-10 w-10 text-teal-400/50 mx-auto" />
            <p className="text-muted-foreground text-sm">No events yet.</p>
            <Button
              asChild
              size="sm"
              className="bg-teal-700 hover:bg-teal-800 text-white rounded-full"
            >
              <Link href="/post/create-promotion" prefetch={false}>
                Create Event
                <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-4 sm:py-6 bg-gradient-to-b from-teal-50/30 to-white dark:from-teal-950/10 dark:to-warm-950">
      <div className="container-page space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TreePalm className="h-6 w-6 text-teal-500" />
            <h2 className="font-display text-xl sm:text-2xl font-bold">Tourism & Events</h2>
          </div>
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="gap-1 text-teal-600 hover:text-teal-700"
          >
            <Link href="/promotions" prefetch={false}>
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <AutoScrollRail ariaLabel="Tourism and events">
          {items.map((item) => (
            <div
              key={item.kind === "tourism" ? `t-${item.data.id}` : `e-${item.data.id}`}
              className="min-w-[300px] max-w-[380px] sm:min-w-[340px] sm:max-w-[380px] h-full"
            >
              {item.kind === "tourism" ? (
                <BusinessPreviewCard
                  href={`/mzansi-business/${item.data.id}`}
                  imageUrl={item.data.cover_photo ?? undefined}
                  posterUrl={item.data.video_thumbnail ?? undefined}
                  logoUrl={item.data.logo_url ?? undefined}
                  title={item.data.business_name}
                  businessType={item.data.business_type as BusinessType}
                  city={item.data.location_city}
                  provinceCode={item.data.location_province}
                  boosted={
                    item.data.boost_until ? new Date(item.data.boost_until) > new Date(now) : false
                  }
                  featured={
                    item.data.featured_until
                      ? new Date(item.data.featured_until) > new Date(now)
                      : false
                  }
                  priority={false}
                  focalX={item.data.focal_x}
                  focalY={item.data.focal_y}
                />
              ) : (
                <PromotionCard
                  id={item.data.id}
                  title={item.data.title}
                  price={item.data.price_cents}
                  negotiable={item.data.price_negotiable}
                  imageUrl={
                    item.data.photos?.[0] || item.data.video_thumbnail || item.data.videos?.[0]
                  }
                  posterUrl={item.data.video_thumbnail || item.data.photos?.[0] || undefined}
                  categoryLabel={getPromotionCategoryDisplayLabel(
                    item.data.category_key,
                    item.data.category
                  )}
                  province={item.data.location_province}
                  city={item.data.location_city}
                  promotionType={item.data.promotion_type as PromotionType}
                  createdAt={item.data.created_at}
                  viewCount={item.data.view_count}
                  boosted={
                    item.data.boost_until ? new Date(item.data.boost_until) > new Date(now) : false
                  }
                  featured={
                    item.data.featured_until
                      ? new Date(item.data.featured_until) > new Date(now)
                      : false
                  }
                  startDate={item.data.start_date}
                  endDate={item.data.end_date}
                  logoUrl={item.data.business_id ? logoMap.get(item.data.business_id) : undefined}
                  priority={false}
                />
              )}
            </div>
          ))}
        </AutoScrollRail>
      </div>
    </section>
  );
}
