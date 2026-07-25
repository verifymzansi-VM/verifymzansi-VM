import { createClient } from "@/lib/supabase/server";
import { MarketPreviewCard } from "./market-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { HomeShowcaseShell } from "./home-showcase-shell";
import { HomeShowcaseEmptyState } from "./home-showcase-empty-state";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { PackageOpen } from "lucide-react";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "./playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";
import { applyVisibleExpiryFilter } from "@/lib/posting/visibility";

const log = createLogger("HomeMzansiMarketShowcase");

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeMzansiMarketShowcase() {
  const cookieStore = await getOptionalCookieStore();
  const hideFixtures = shouldHidePlaywrightFixtures(
    readCookieValue(cookieStore, PLAYWRIGHT_HIDE_FIXTURES_COOKIE)
  );
  const supabase = await createClient();
  const { data: listings, error } = await applyVisibleExpiryFilter(
    supabase.from("listings").select("*").eq("status", "live").eq("area", "MZANSI_MARKET")
  )
    .order("boost_until", { ascending: false, nullsFirst: false })
    .order("featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(16);

  if (error) {
    log.warn("Failed to load home Mzansi Market showcase", { error: error.message });
    return null;
  }

  const items = (listings ?? [])
    .filter((listing) => !shouldHidePlaywrightFixtureRowWhenEnabled(listing, hideFixtures))
    .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
    .slice(0, 8);
  if (items.length === 0) {
    return (
      <HomeShowcaseShell
        badge="Mzansi Market"
        title="Latest on Mzansi Market"
        description="Local sellers, real products, identity-reviewed members."
        href="/mzansi-market"
        ctaLabel="View All Listings"
        tone="green"
      >
        <HomeShowcaseEmptyState
          title="No listings yet."
          description="The marketplace is clean. Publish the first ad and this rail will fill with fresh posts."
          ctaHref="/post/create-listing"
          ctaLabel="Post First Listing"
          tone="green"
          icon={<PackageOpen className="h-7 w-7" />}
        />
      </HomeShowcaseShell>
    );
  }

  return (
    <HomeShowcaseShell
      badge="Mzansi Market"
      title="Latest on Mzansi Market"
      description="Local sellers, real products, identity-reviewed members."
      href="/mzansi-market"
      ctaLabel="View All Listings"
      tone="green"
    >
      <AutoScrollRail ariaLabel="Latest on Mzansi Market" showEdgeFades={false} flushEdges>
        {items.map((l) => {
          const displayUrl = l.videos?.[0] || l.video_thumbnail || l.photos?.[0];
          const isBoosted = l.boost_until ? new Date(l.boost_until) > new Date() : false;
          const poster = l.video_thumbnail || l.photos?.[0] || undefined;
          return (
            <div key={l.id} className="h-full w-[272px] sm:w-[296px] lg:w-[260px]">
              <MarketPreviewCard
                href={`/listing/${l.id}`}
                imageUrl={displayUrl}
                posterUrl={poster}
                title={l.title}
                price={l.price_cents ? l.price_cents / 100 : null}
                city={l.location_city ?? "South Africa"}
                provinceCode={provinceCode(l.location_province ?? "ZA")}
                boosted={isBoosted}
                logoUrl={l.logo_url}
                priority={false}
                focalX={l.focal_x as number | null | undefined}
                focalY={l.focal_y as number | null | undefined}
                mediaWidth={l.media_width as number | null | undefined}
                mediaHeight={l.media_height as number | null | undefined}
              />
            </div>
          );
        })}
      </AutoScrollRail>
    </HomeShowcaseShell>
  );
}
