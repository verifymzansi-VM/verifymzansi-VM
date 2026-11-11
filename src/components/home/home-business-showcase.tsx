import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { restoredHomeCollection } from "@/lib/foundation/marketplace-server";
import { BusinessPreviewCard } from "./business-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { HomeShowcaseShell } from "./home-showcase-shell";
import { HomeShowcaseEmptyState } from "./home-showcase-empty-state";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import type { BusinessType } from "@/types/enums";
import { Building2 } from "lucide-react";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "./playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeBusinessShowcase() {
  const cookieStore = await getOptionalCookieStore();
  const hideFixtures = shouldHidePlaywrightFixtures(
    readCookieValue(cookieStore, PLAYWRIGHT_HIDE_FIXTURES_COOKIE)
  );
  const { data: businesses } = await restoredHomeCollection("businesses");

  const items = (businesses ?? [])
    .filter((business) => !shouldHidePlaywrightFixtureRowWhenEnabled(business, hideFixtures))
    .filter(
      (business) => !isPlaceholderMarketplaceContent(business.business_name, business.description)
    )
    .slice(0, 8);
  if (items.length === 0) {
    return (
      <HomeShowcaseShell title="Mzansi Business" href="/mzansi-business" tone="blue">
        <HomeShowcaseEmptyState
          title="No businesses yet"
          description="Add your business and it will show here. Your first post is free once your ID is reviewed."
          ctaHref="/post/create-business"
          ctaLabel="Add a business"
          tone="blue"
          icon={<Building2 className="h-7 w-7" />}
        />
      </HomeShowcaseShell>
    );
  }
  return (
    <HomeShowcaseShell title="Mzansi Business" href="/mzansi-business" tone="blue">
      <AnalyticsImpressions
        items={items.map((b) => ({ table: "businesses" as const, id: String(b.id) }))}
        type="homepage_appearance"
        surface="home_business"
      />
      <AutoScrollRail
        ariaLabel="Mzansi Business"
        showEdgeFades={false}
        flushEdges
        itemClassName="w-[64%] sm:w-auto"
      >
        {items.map((b) => (
          <div key={b.id} className="h-full w-full sm:w-[280px] lg:w-[240px]">
            <BusinessPreviewCard
              href={`/mzansi-business/${b.id}`}
              businessId={b.id}
              imageUrl={(b.cover_video || b.video_thumbnail || b.cover_photo) as string | undefined}
              posterUrl={b.video_thumbnail || b.cover_photo || undefined}
              logoUrl={b.logo_url as string | undefined}
              title={b.business_name}
              businessType={(b.business_type || "general_store") as BusinessType}
              city={b.location_city ?? "South Africa"}
              provinceCode={provinceCode(b.location_province ?? "ZA")}
              boosted={b.boost_until ? new Date(b.boost_until) > new Date() : false}
              featured={b.featured_until ? new Date(b.featured_until) > new Date() : false}
              priority={false}
              focalX={b.focal_x as number | null | undefined}
              focalY={b.focal_y as number | null | undefined}
              mediaWidth={b.media_width as number | null | undefined}
              mediaHeight={b.media_height as number | null | undefined}
            />
          </div>
        ))}
      </AutoScrollRail>
    </HomeShowcaseShell>
  );
}
