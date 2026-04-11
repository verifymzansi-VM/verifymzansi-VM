import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MarketPreviewCard } from "./market-preview-card";
import { AutoScrollRail } from "./auto-scroll-rail";
import { SA_PROVINCES } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";
import { isPlaceholderMarketplaceContent } from "./placeholder-content-filter";
import { shouldHidePlaywrightFixtureRowWhenEnabled } from "./playwright-fixture-filter";
import {
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE,
  shouldHidePlaywrightFixtures,
} from "@/lib/supabase/playwright-visual-fixtures";

const log = createLogger("HomeMzansiMarketShowcase");

function provinceCode(name: string): string {
  return SA_PROVINCES.find((p) => p.name.toLowerCase() === name?.toLowerCase())?.code ?? name;
}

export async function HomeMzansiMarketShowcase() {
  const cookieStore = await cookies();
  const hideFixtures = shouldHidePlaywrightFixtures(
    cookieStore.get(PLAYWRIGHT_HIDE_FIXTURES_COOKIE)?.value
  );
  const supabase = await createClient();
  const { data: listings, error } = await supabase
    .from("listings")
    .select("*")
    .eq("status", "live")
    .eq("area", "MZANSI_MARKET")
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
  if (items.length === 0) return null;

  return (
    <section className="py-4 sm:py-6 bg-gradient-to-b from-brand-green-50/30 to-white dark:from-brand-green-950/20 dark:to-transparent">
      <div className="container-page space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl text-brand-green-900 dark:text-brand-green-100">
              Latest on Mzansi Market
            </h2>
            <p className="text-muted-foreground text-sm sm:text-base max-w-2xl">
              Verified sellers. Real products. Video & photos.
            </p>
          </div>
          <Link href="/mzansi-market" prefetch={false} className="shrink-0">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-green hover:text-brand-green/80 transition-colors">
              View All Listings
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </div>

        <AutoScrollRail ariaLabel="Latest on Mzansi Market">
          {items.map((l) => {
            const displayUrl = l.videos?.[0] || l.video_thumbnail || l.photos?.[0];
            const isBoosted = l.boost_until ? new Date(l.boost_until) > new Date() : false;
            const poster = l.video_thumbnail || l.photos?.[0] || undefined;
            return (
              <div
                key={l.id}
                className="min-w-[200px] max-w-[260px] sm:min-w-[220px] sm:max-w-[280px] h-full"
              >
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
      </div>
    </section>
  );
}
