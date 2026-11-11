import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { restoredHomeCollection } from "@/lib/foundation/marketplace-server";
import { MarketPreviewCard } from "./market-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { HomeShowcaseShell } from "./home-showcase-shell";
import { HomeShowcaseEmptyState } from "./home-showcase-empty-state";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { PackageOpen } from "lucide-react";

const log = createLogger("HomeMzansiMarketShowcase");

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeMzansiMarketShowcase() {
  const { data: listings, error } = await restoredHomeCollection("listings");

  if (error) {
    log.warn("Failed to load home Mzansi Market showcase", { error: error.message });
    return null;
  }

  const items = (listings ?? [])
    .filter((listing) => !isPlaceholderMarketplaceContent(listing.title, listing.description))
    .slice(0, 8);
  if (items.length === 0) {
    return (
      <HomeShowcaseShell title="Mzansi Market" href="/mzansi-market" tone="green">
        <HomeShowcaseEmptyState
          title="No listings yet"
          description="Post something to sell or rent out and it will show here. Your first post is free once your ID is reviewed."
          ctaHref="/post/create-listing"
          ctaLabel="Post a listing"
          tone="green"
          icon={<PackageOpen className="h-7 w-7" />}
        />
      </HomeShowcaseShell>
    );
  }

  return (
    <HomeShowcaseShell title="Mzansi Market" href="/mzansi-market" tone="green">
      <AnalyticsImpressions
        items={items.map((l) => ({ table: "listings" as const, id: String(l.id) }))}
        type="homepage_appearance"
        surface="home_market"
      />
      <AutoScrollRail
        ariaLabel="Latest on Mzansi Market"
        showEdgeFades={false}
        flushEdges
        itemClassName="w-[64%] sm:w-auto"
      >
        {items.map((l) => {
          const displayUrl = l.videos?.[0] || l.video_thumbnail || l.photos?.[0];
          const isBoosted = l.boost_until ? new Date(l.boost_until) > new Date() : false;
          const poster = l.video_thumbnail || l.photos?.[0] || undefined;
          return (
            <div key={l.id} className="h-full w-full sm:w-[280px] lg:w-[240px]">
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
