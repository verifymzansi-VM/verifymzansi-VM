import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { PromotionCard } from "@/components/listings/promotion-card";
import { BusinessPreviewCard } from "@/components/home/business-preview-card";
import { restoredHomeCollection } from "@/lib/foundation/marketplace-server";
import { AutoScrollRail } from "./auto-scroll-rail";
import { HomeShowcaseShell } from "./home-showcase-shell";
import { HomeShowcaseEmptyState } from "./home-showcase-empty-state";
import type { BusinessCategory, BusinessType, PromotionType } from "@/types/enums";
import { getPromotionCategoryDisplayLabel } from "@/lib/utils/promotion-category";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "./playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";

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
  { kind: "event"; data: PromotionRow } | { kind: "tourism"; data: TourismBusinessRow };

export async function HomePromotionsShowcase() {
  const cookieStore = await getOptionalCookieStore();
  const hideFixtures = shouldHidePlaywrightFixtures(
    readCookieValue(cookieStore, PLAYWRIGHT_HIDE_FIXTURES_COOKIE)
  );
  const now = new Date().toISOString();

  const [{ data: eventData }, { data: tourismData }] = await Promise.all([
    restoredHomeCollection("promotions"),
    restoredHomeCollection("businesses", true),
  ]);

  const eventRows = (eventData || []) as unknown as PromotionRow[];

  const promotions = eventRows
    .filter((promotion) => !shouldHidePlaywrightFixtureRowWhenEnabled(promotion, hideFixtures))
    .filter((promotion) => !isPlaceholderMarketplaceContent(promotion.title))
    .slice(0, 4);
  const tourismRows = (tourismData || []) as unknown as TourismBusinessRow[];

  const tourismBusinesses = tourismRows
    .filter((b) => !shouldHidePlaywrightFixtureRowWhenEnabled(b, hideFixtures))
    .filter((b) => !isPlaceholderMarketplaceContent(b.business_name))
    .slice(0, 4);

  // Interleave tourism and events
  const items: ShowcaseItem[] = [];
  const maxLen = Math.max(tourismBusinesses.length, promotions.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < tourismBusinesses.length) items.push({ kind: "tourism", data: tourismBusinesses[i] });
    if (i < promotions.length) items.push({ kind: "event", data: promotions[i] });
  }

  if (items.length === 0) {
    return (
      <HomeShowcaseEmptyState
        title="Be the first to list a stay or event"
        href="/post/create-tourism"
        tone="teal"
      />
    );
  }

  return (
    <HomeShowcaseShell title="Tourism & Events" href="/tourism-events" tone="teal">
      <AnalyticsImpressions
        items={items.map((item) => ({
          table: item.kind === "event" ? ("promotions" as const) : ("businesses" as const),
          id: String(item.data.id),
        }))}
        type="homepage_appearance"
        surface="home_tourism"
      />
      <AutoScrollRail
        ariaLabel="Tourism and events"
        showEdgeFades={false}
        flushEdges
        itemClassName="w-[64%] sm:w-auto"
      >
        {items.map((item) => (
          <div
            key={item.kind === "tourism" ? `t-${item.data.id}` : `e-${item.data.id}`}
            className="h-full w-full sm:w-[280px] lg:w-[240px]"
          >
            {item.kind === "tourism" ? (
              <BusinessPreviewCard
                href={`/tourism-events/${item.data.id}`}
                businessId={item.data.id}
                imageUrl={
                  item.data.cover_video ||
                  item.data.video_thumbnail ||
                  item.data.cover_photo ||
                  undefined
                }
                posterUrl={item.data.video_thumbnail || item.data.cover_photo || undefined}
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
                isVideo={Boolean(item.data.cover_video)}
              />
            ) : (
              <PromotionCard
                immersive
                id={item.data.id}
                title={item.data.title}
                price={item.data.price_cents}
                negotiable={item.data.price_negotiable}
                imageUrl={
                  item.data.videos?.[0] || item.data.video_thumbnail || item.data.photos?.[0]
                }
                posterUrl={item.data.video_thumbnail || item.data.photos?.[0] || undefined}
                isVideo={Boolean(item.data.videos?.[0])}
                categoryLabel={getPromotionCategoryDisplayLabel(
                  item.data.category_key,
                  item.data.category
                )}
                province={item.data.location_province}
                city={item.data.location_city}
                promotionType={item.data.promotion_type as PromotionType}
                createdAt={item.data.created_at}
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
                priority={false}
                mediaWidth={item.data.media_width}
                mediaHeight={item.data.media_height}
                disableNativeDrag
              />
            )}
          </div>
        ))}
      </AutoScrollRail>
    </HomeShowcaseShell>
  );
}
