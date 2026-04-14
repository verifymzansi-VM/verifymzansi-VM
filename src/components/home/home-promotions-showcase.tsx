import Link from "next/link";
import { cookies } from "next/headers";
import { TreePalm, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PromotionCard } from "@/components/listings/promotion-card";
import { BusinessPreviewCard } from "@/components/home/business-preview-card";
import { createClient } from "@/lib/supabase/server";
import { AutoScrollRail } from "./auto-scroll-rail";
import { HomeShowcaseShell } from "./home-showcase-shell";
import type { BusinessCategory, BusinessType, PromotionType } from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import {
  buildPublicEventPromotionsQuery,
  buildPublicTourismBusinessesQuery,
} from "@/lib/promotions/public-tourism-events";
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
  media_width: number | null;
  media_height: number | null;
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
  media_width: number | null;
  media_height: number | null;
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

  const { data: eventData } = await buildPublicEventPromotionsQuery(
    supabase,
    now,
    "id, title, price_cents, price_negotiable, photos, videos, video_thumbnail, category, category_key, location_province, location_city, promotion_type, view_count, boost_until, featured_until, media_width, media_height, start_date, end_date, created_at, business_id"
  ).limit(8);

  const promotions = ((eventData || []) as PromotionRow[])
    .filter((promotion) => !shouldHidePlaywrightFixtureRowWhenEnabled(promotion, hideFixtures))
    .filter((promotion) => !isPlaceholderMarketplaceContent(promotion.title))
    .slice(0, 4);

  const { data: tourismData } = await buildPublicTourismBusinessesQuery(
    supabase,
    "id, business_name, business_type, cover_photo, cover_video, video_thumbnail, logo_url, location_province, location_city, boost_until, featured_until, focal_x, focal_y, media_width, media_height"
  ).limit(8);

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
      <HomeShowcaseShell
        badge="Tourism & Events"
        title="Tourism & Events"
        description="Destinations, stays, and live experiences across South Africa."
        href="/promotions"
        ctaLabel="View All"
        tone="teal"
        icon={<TreePalm className="h-3.5 w-3.5" />}
      >
        <div className="rounded-[1.5rem] border border-dashed border-slate-300/70 bg-white/70 p-8 text-center shadow-inner dark:border-white/10 dark:bg-white/[0.03]">
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-500/10 text-teal-600 dark:bg-teal-500/15 dark:text-teal-200">
              <TreePalm className="h-7 w-7" />
            </div>
            <p className="font-medium text-slate-900 dark:text-white">No events yet.</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Create the first tourism or event showcase and it will appear here.
            </p>
            <Button
              asChild
              size="sm"
              className="rounded-full bg-teal-700 px-5 text-white hover:bg-teal-800"
            >
              <Link href="/post/create-tourism" prefetch={false}>
                Create Event
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </HomeShowcaseShell>
    );
  }

  return (
    <HomeShowcaseShell
      badge="Tourism & Events"
      title="Tourism & Events"
      description="Destinations, stays, and live experiences across South Africa presented in the same hero-led visual language."
      href="/promotions"
      ctaLabel="View All"
      tone="teal"
      icon={<TreePalm className="h-3.5 w-3.5" />}
    >
      <AutoScrollRail ariaLabel="Tourism and events" showEdgeFades={false} flushEdges>
        {items.map((item) => (
          <div
            key={item.kind === "tourism" ? `t-${item.data.id}` : `e-${item.data.id}`}
            className="h-full min-w-[210px] max-w-[272px] sm:min-w-[228px] sm:max-w-[296px] lg:min-w-[248px] lg:max-w-[320px]"
          >
            {item.kind === "tourism" ? (
              <BusinessPreviewCard
                href={`/mzansi-business/${item.data.id}`}
                imageUrl={
                  item.data.cover_video ||
                  item.data.video_thumbnail ||
                  item.data.cover_photo ||
                  undefined
                }
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
                mediaWidth={item.data.media_width}
                mediaHeight={item.data.media_height}
              />
            ) : (
              <PromotionCard
                id={item.data.id}
                title={item.data.title}
                price={item.data.price_cents}
                negotiable={item.data.price_negotiable}
                imageUrl={
                  item.data.videos?.[0] || item.data.video_thumbnail || item.data.photos?.[0]
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
                mediaWidth={item.data.media_width}
                mediaHeight={item.data.media_height}
              />
            )}
          </div>
        ))}
      </AutoScrollRail>
    </HomeShowcaseShell>
  );
}
